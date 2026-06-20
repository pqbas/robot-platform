# Conteo con tiling (método `tiled`) seleccionable por objeto

## Qué

Agregar al `counting_worker` un segundo método de conteo offline, **`tiled`**,
portado de `mlops-blueberry-counting/ops/strategies/tiled_crossing.py`, y dejar
que el método sea **seleccionable**:

- **Por tipo de objeto** (modelo + clase): cada objeto puede fijar su método de
  conteo (`single` | `tiled`). Default siempre `single` (line-crossing actual).
- **Por re-procesamiento**: el diálogo de re-procesar prellena el método del
  objeto y permite cambiarlo para esa corrida.

## Por qué

Durante las visitas se observó que el método con tiling mejora de forma
significativa el conteo de arándanos. Las métricas del repo de mlops
(`POST_PROCESSING.md`) lo confirman: el MAE de `line_crossing` (~57-78%) baja a
~22-48% con `tiled_crossing` para los mismos detectores. El tiling reescala cada
arándano a mayor tamaño y reduce el churn de `track_id`, que es la causa
principal del sub/sobre-conteo.

El método `tiled` recorta el cuadrado central, toma la franja central (ancho =
mitad del lado) y la parte en **2 tiles cuadrados apilados** (superior/inferior).
Cada tile corre con su **propia instancia YOLO** (tracker independiente) y cuenta
cruces de una **línea vertical** en su centro; el total es la suma de ambos. La
frontera horizontal entre tiles es paralela al movimiento, así que un arándano
vive en un solo tile salvo los que caen sobre el corte.

## Alcance

- **Worker** (`counting_worker/processor.py`): despacho por `method`; el método
  `tiled` reusa el `ObjectCounter` del robot (2 instancias) y **remapea las cajas
  de cada tile a píxeles de frame completo** para que el sidecar `{uuid}.jsonl`
  (y por tanto el replay) siga alineado por construcción.
- **Backend**: `method` viaja en el `count_config` y en el payload del worker;
  nueva persistencia por-objeto `counting_methods.json` (espejo de
  `counting_settings.py`), endpoints GET/PUT para leer/fijar el método por objeto.
- **Frontend**: selector de método en el diálogo de re-procesar; sección en
  ajustes de conteo para fijar el método por objeto.

## Fuera de alcance

- El **overlay en vivo** (cámara en tiempo real) NO cambia: sigue siendo
  line-crossing. `tiled` es solo offline (reprocesa el MP4 grabado).
- No se porta la estrategia `embeddings` de mlops.
- El conteo automático al detener una sesión sigue usando el método del objeto
  (default `single`); no se fuerza `tiled` globalmente.

## Decisiones

- **Reusar el `ObjectCounter` del robot, no el de mlops.** El del robot es el
  validado contra el overlay en vivo y tiene el test de paridad. En `tiled` se
  instancian 2 (uno por tile), `count_mode="horizontal"`, `threshold=0.5`,
  `direction` configurable. Coords normalizadas dentro de cada tile.
- **Dos instancias del engine TensorRT** (una por tile) para trackers
  independientes, igual que mlops. Duplica memoria del engine — aceptable para un
  detector pequeño en Orin; se valida en `make run-counting`.
- **Persistencia por-objeto en JSON, no en DB.** Evita migración; mirror exacto
  de `counting_settings.py`. Clave `"{model_uuid}::{label}"`, default `single`.
  El conteo es robot-only (el worker vive en el robot), así que un settings file
  basta (como `camera_settings`/`counting_settings`).
- **`tiled` fuerza `count_mode="horizontal"` y `roi_mode="square"`** (la geometría
  del método lo requiere). El `threshold` queda en 0.5 (centro del tile). Solo
  `direction` (izq↔der), `confidence` y el modelo siguen siendo configurables.
- **Compatibilidad hacia atrás:** configs/grabaciones sin `method` → `single`.
