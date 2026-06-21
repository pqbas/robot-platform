# Requirements: Categorías como centro + clasificación post-conteo

## Scope

El sistema se reorganiza alrededor de **Categorías** (arándano, persona, …) como
entidad central. Una categoría es el **slot de despliegue** que guarda *lo mejor*
ya elegido para ese objeto: su **detector**, su **clasificador** (opcional) y su
**método de conteo**. La plataforma **coloca** los modelos ganadores por
categoría; **no** es donde se descubre cuál es el mejor (eso es experimentación y
vive fuera, en el repo de mlops/Modal).

Esta fase entrega cuatro cosas acopladas:

1. **Hub de categorías** — tabla `categories` con el detector + clasificador +
   método por categoría, gestionada en el server y sincronizada al robot.
2. **Conteo resuelto por categoría** — `build_count_config` resuelve el detector
   y el método desde la categoría (supersede la selección por
   `selected_label`/`select-label`).
3. **Clasificación post-conteo** — tras contar, si la categoría tiene clasificador
   asignado, un `classification-worker` independiente recorta cada objeto contado
   (crop del bbox en el frame del cruce), lo clasifica con una CNN propia, y
   produce crops + resultados + resumen.
4. **Frontend centrado en categorías** — una vista donde cada categoría muestra
   su detector y su clasificador; ahí se sube y se asigna *lo mejor*.

Después de esta fase, configurar el sistema = elegir, por categoría, el mejor
detector y el mejor clasificador (un solo lugar). Contar arándano resuelve su
detector desde la categoría y, al terminar, clasifica automáticamente.

**Fuera de alcance:** experimentación / comparación de modelos (vive en mlops);
clasificación en vivo; overlay por-objeto de la etiqueta sobre el replay (solo
resumen + galería); conversión TensorRT del clasificador (corre en PyTorch
directo).

## Inputs / Data

### Tabla nueva `categories` (el hub)

| Columna | Tipo | Notas |
|---------|------|-------|
| `name` | TEXT PK | la categoría = la clase contada (ej. `arandano`); coincide con un `system_label` del detector |
| `detection_model_uuid` | TEXT FK → `detection_models` | el "mejor" detector elegido |
| `classification_model_uuid` | TEXT FK → `classification_models`, nullable | el "mejor" clasificador; `NULL` = la categoría no clasifica |
| `method` | TEXT default `'single'` | `single`\|`tiled` (absorbe `counting_methods.json`) |
| `count_mode` | TEXT default `'horizontal'` | `horizontal`\|`vertical` (orientación de la línea) |
| `threshold` | REAL default `0.5` | posición de la línea normalizada [0,1] |
| `direction` | TEXT default `'left2right'` | `left2right`\|`right2left`\|`top2down`\|`down2top` |
| `roi_mode` | TEXT default `'square'` | `square`\|`full` |
| `confidence` | REAL default `0.25` | umbral mínimo de confianza |
| `updated_at` | TEXT | ISO |

La **geometría de conteo** (método + línea/dirección/ROI/confianza) vive **en la
categoría**: contar arándano usa un set de parámetros, contar personas otro.

Server-authoritative; sincronizada al robot (pull). **Muchas categorías → un
detector** (un detector con `class_mapping` multi-clase sirve a varias
categorías); **un clasificador por categoría**.

### Tabla nueva `classification_models` (la biblioteca de clasificadores)

| Columna | Tipo | Notas |
|---------|------|-------|
| `uuid` | TEXT PK | |
| `version` | TEXT | etiqueta humana ("blueberry-ripeness-v1") |
| `filename` | TEXT | basename del `.pt` en `data/<mode>/models/` |
| `file_hash` | TEXT | sha256 del `.pt` (cache + identidad del pin) |
| `source` | TEXT | `"uploaded"` \| `"library"` |
| `class_names` | TEXT (JSON) | lista **ordenada** índice→nombre (la del checkpoint) |
| `num_classes` | INTEGER | |
| `latent_dim` | INTEGER | default 128 |
| `imgsz` | INTEGER | default 128 |
| `created_at` | TEXT | ISO |

### Evento de cruce (counting-worker → sidecar nuevo `{uuid}.crossings.jsonl`)

Una línea por **objeto contado** (no por frame), escrita en el instante del cruce:

| Campo | Tipo | Notas |
|-------|------|-------|
| `track_id` | int | ID ByteTrack del objeto que cruzó |
| `frame` | int | índice de frame (0-based) del cruce |
| `pts` | float | timestamp de presentación (s) |
| `bbox` | [float×4] | `xyxy` en píxeles de **frame completo** (tiled ya remapea) |
| `cls` | string | clase contada |

Contrato agnóstico al método (single/tiled).

### Job al `classification-worker` (socket `/tmp/classification.sock`, JSON length-prefixed)

`{cmd:"classify"|"status", uuid, video_path, crossings_path,
classifications_path, crops_dir, model_path, class_names, num_classes,
latent_dim, imgsz}`. Salida sidecar `{uuid}.classifications.jsonl`, una línea por
crop: `{track_id, frame, pts, bbox, crop_path, class_name, confidence, probs}`.
`status` → `{state, current, last_result:{ok, total, distribution:{clase:n},
finished_at}}`.

### Columnas nuevas en `recordings` (migración Alembic)

| Columna | Tipo | Notas |
|---------|------|-------|
| `classification_status` | TEXT default `'none'` | `none`\|`pending`\|`classifying`\|`done`\|`error` |
| `classification_error` | TEXT nullable | |
| `classification_config` | TEXT nullable | pin del clasificador (`classification_model_uuid`, `version`, `file_hash`, `class_names`, `num_classes`, `latent_dim`, `imgsz`, `model_path`) |
| `classifications_uploaded_at` | TEXT nullable | gate de subida **automática** de resultados+metadata |
| `crops_uploaded_at` | TEXT nullable | gate de subida **manual** (con el video) |

### Persistencia de resultados (tablas existentes, migración 002)

Se reutilizan `FruitCrop` y `FruitClassification`. `FruitCrop` gana
`recording_uuid` (migración) — el artefacto es el video; la `Session` puede no
existir al terminar el conteo. Cada cruce → 1 `FruitCrop` + 1 `FruitClassification`.

## Behavior

- **Selección de qué contar = elegir una categoría.** El operador (o la config
  activa) selecciona una categoría; eso resuelve el detector (para cargar el live
  + contar), el método y, si lo hay, el clasificador. Reemplaza la selección por
  clase+modelo cruda / `select-label`.
- **Conteo:** `build_count_config(category)` snapshotea el detector de la
  categoría (uuid/version/file_hash/engine_path), el `target_model_label`
  (vía `class_mapping`), y **toda la geometría de la categoría** (method +
  count_mode/threshold/direction/roi_mode/confidence). El pin de modelo en
  `count_config` se mantiene (reproducibilidad / recount).
- **Disparo de clasificación:** cuando el counting-poller marca
  `count_status='done'`, mira la categoría contada; si tiene
  `classification_model_uuid`, snapshotea el pin en `classification_config`, marca
  `classification_status='pending'` y encola. Si `NULL`, queda `none` (costo cero).
- **Worker de clasificación:** un job a la vez (`busy`), idle sin GPU. Lee los
  cruces; por cada uno hace `seek` al frame, recorta el bbox, preprocesa (BGR→RGB,
  resize 128×128 por estiramiento, `ToTensor` [0,1], **sin** normalización), corre
  el `SupervisedModel` (forward→softmax), guarda crop JPG y emite la línea.
- **Poller de clasificación:** transcribe el sidecar a `FruitCrop` +
  `FruitClassification`, marca `done`, limpia `classifications_uploaded_at`
  (dirty → re-sube) y re-encola el `SyncLog`; error → `error` + mensaje.
- **Sync automático:** resultados + metadata de crops (sin bytes) suben solos
  (`classifications_uploaded_at`). **Manual (botón de sesión):** video + crops JPG
  (`crops_uploaded_at`).
- **Convivencia con lo existente:** `is_active` de un detector sigue controlando
  qué entra a la **biblioteca** que se sincroniza al robot (varios activos OK); la
  **categoría** decide cuál de esa biblioteca se *usa* (supersede `select-label`).
- **Gestión server:** crear categoría, asignarle detector y clasificador, subir el
  `.pt` del clasificador — todo en el server; el robot lo recibe por sync.
- **Reconciliación en arranque:** recordings en `classifying` huérfanos →
  re-encolar si MP4 + crossings + `.pt` del pin existen; si no, `error`.

## Decisions

- **La Categoría es el centro (detección + conteo + clasificación)** (decisión
  20-06-26) — directiva del usuario: un solo lugar de config por fruto. Modelar
  muchas relaciones (modelo↔clase↔config↔clasificador) complica front y back; la
  categoría como hub colapsa eso a "elige el mejor detector y el mejor
  clasificador para arándano". Hacerla centro **solo para clasificación** dejaría
  la detección resolviéndose por `select-label` → dos sistemas de config para un
  fruto, justo la complejidad a evitar. Por eso gobierna también el conteo.
- **Registros = biblioteca, categoría = slot de despliegue** — `DetectionModel` /
  `ClassificationModel` son el catálogo del que se elige *lo mejor*; la categoría
  guarda el ganador. Esa es la línea experimentación↔despliegue: aquí se
  **coloca**, no se descubre. La experimentación vive en
  `../mlops-classification-blueberry` / Modal.
- **Muchas categorías → un detector; un clasificador por categoría** — `class_mapping`
  es multi-clase, así que un detector sirve a varias categorías; no se modela 1:1.
- **La categoría supersede `select-label`, convive con `is_active`/multi-active**
  — `is_active` controla la biblioteca sincronizada (varios detectores activos
  OK); la categoría decide cuál se usa. No se contradice con
  `spec/20-04-26-multi-active-models` (categorías distintas → detectores distintos).
- **`method` (single/tiled) se muda a la categoría; se retira `counting_methods.json`**
  — ya estaba keyed por `{model_uuid}::{label}`, que es la categoría de facto;
  unificarlo en la categoría evita un segundo lugar de config. (Riesgo: tiled-counting
  recién entró; se migran los valores actuales del JSON a `categories.method`.)
- **La geometría de conteo (método + línea/dirección/ROI/confianza) vive en la
  categoría** (decisión 20-06-26) — contar arándano requiere un set de parámetros
  distinto al de contar personas, así que la geometría ES parte de cómo se cuenta
  cada categoría, no un tuning global. `config.counting` pasa a ser solo el
  **default semilla** para crear categorías nuevas (el backfill de la migración lo
  usa); en tiempo de conteo `build_count_config` lee la geometría de la categoría,
  no de `config.counting`.
- **El evento de cruce lo emite el counting-worker, no se reconstruye** — el
  `count` del sidecar es acumulado; atribuir un incremento a un `track_id`
  exigiría replicar `LIST_0/LIST_1` de `object_counter.py` desde el frame 0 **y**
  para tiled (dos counters, coords remapeadas). El worker ya conoce el cruce:
  emitir `{track_id, frame, pts, bbox}` da un contrato agnóstico al método con un
  cambio chico en la única fuente de verdad.
- **Worker de clasificación independiente, PyTorch directo, sin TensorRT** — el
  clasificador es un `nn.Module` propio (`SupervisedModel`), no un YOLO; el
  `conversion-worker` (`YOLO.export`) no aplica. Una CNN 128×128 sobre decenas de
  crops es milisegundos; el export ONNX en Jetson es doloroso y no aporta. Se
  vendorea `nn/layers.py`, `nn/backbone.py`, `models/supervised.py` (torch puro;
  los workers no importan código entre sí) y se carga el `state_dict`.
- **`class_names` viaja con el checkpoint; preprocesado idéntico al training** —
  el orden índice→nombre lo fija el training (`discover_classes` = subcarpetas
  ordenadas); se guarda en `ClassificationModel.class_names`, no se hardcodea. BGR→RGB,
  resize por estiramiento, [0,1] sin normalización: cualquier desviación degrada
  precisión en silencio.
- **Estado de clasificación en `Recording`** — el artefacto es el video; la
  `Session` puede no existir al terminar el conteo. Por eso `FruitCrop` gana
  `recording_uuid`; la `Session` se relaciona vía `recording_uuid` al guardar.
- **Sync partido: resultados automático, crops/video manual** — decisión del
  usuario (mismo trato que el video). Los JPG son pesados; gatearlos tras el botón
  de sesión evita saturar el uplink; los resultados (livianos) suben solos.
- **El pipeline completo se construye y valida con pesos aleatorios** —
  `SupervisedModel(num_classes=7)` sin entrenar valida crops, preprocesado,
  protocolo, DB, sync y UI. La precisión real espera el checkpoint del usuario
  (arándano, listo) + la lista ordenada de clases.

## Context

- See `spec/15-06-26-conteo-diferido/` — el conteo diferido que esta fase
  extiende; `count_config` (pin de modelo) y el molde worker+poller son la base.
- See `spec/20-06-26-tiled-counting/` — el método tiled (remapeo de bbox a frame
  completo) que `crossings.jsonl` respeta y cuyo `counting_methods.json` se absorbe.
- See `spec/20-04-26-multi-active-models/` y `spec/18-04-26-device-model-assignment/`
  — `is_active`/biblioteca vs uso; patrón de gestión de modelos server-authoritative
  a espejar para categorías + clasificadores.
- See `spec/30-05-26-lan-first-upload/` y el patrón `uploaded_at` /
  `detections_uploaded_at` — gates de subida a espejar.
- See `spec/roadmap.md` — añadir como fase: "categorías como centro + clasificación".
- Modelo fuente: `../mlops-classification-blueberry/src/{nn/layers.py,
  nn/backbone.py,models/supervised.py,dataset.py}`.
- Patrones a seguir:
  `src/back/services/perception/counting_trigger.py::build_count_config`
  (resolución de modelo que pasa a leer de la categoría),
  `src/counting_worker/counting_worker/{main.py,processor.py}` (worker),
  `src/back/services/perception/{counting_client.py,counting_poller.py}`
  (cliente/poller), `src/back/models.py` (`FruitCrop`/`FruitClassification`),
  `src/back/services/sync_recordings_upload.py` (gate de subida del sidecar).
</content>
