# Requirements: Sync de clasificación de madurez robot → servidor

## Scope

Hoy la clasificación de madurez (ripeness) vive **solo en el robot**: al abrir el
modal "Clasificación" en la web del **servidor** no aparece nada, porque el sync
nunca empuja esos datos. Esta fase cierra ese hueco — el "Grupo 5 / upload loop"
que el poller ya anticipa (ver `classification_poller.py:169-171`, comentario
*"mark dirty so the upload loop (G5) pushes the classifications metadata"*).

Tras esta fase, una grabación clasificada en el robot, una vez sincronizada,
muestra en el **servidor** exactamente lo mismo que en el robot: estado
`done`, distribución por tipo (bar chart) y galería de recortes. Sin cambios de
frontend — el `RipenessDialog` y los endpoints `/classifications` y
`/crops/{filename}` ya funcionan en modo server (el endpoint de crops ya declara
*"Available in robot and server mode — the server has the synced crops"*); solo
faltan los datos.

**Fuera de scope:** re-clasificar en el server (no tiene worker/GPU garantizado);
UI nueva; cambios de esquema DB (ya existen, ver Decisiones).

## Inputs / Data

Artefactos locales del robot que hay que llevar al server (paths vía
`classification_trigger.py`):

| Artefacto | Path (robot) | Peso | Destino en server |
|-----------|--------------|------|-------------------|
| Metadata de clasificación | fila `recordings` (`classification_status`, `classification_error`, `classification_config`) | trivial | columnas homónimas en `recordings` |
| `{uuid}.classifications.jsonl` | `{dir(mp4)}/{uuid}.classifications.jsonl` | ligero | mismo path bajo `recordings_dir`, luego transcrito a `fruit_crops`/`fruit_classifications` |
| `{uuid}.crossings.jsonl` | `{dir(mp4)}/{uuid}.crossings.jsonl` | ligero | mismo path (para completitud / re-clasificación futura) |
| Recortes JPG | `{dir(mp4)}/crops/{uuid}/*.jpg` | **pesado** | `crops_dir_for(rec)` en el server |

Flags de bookkeeping robot-local (ya existen en el modelo `Recording`):
`classifications_uploaded_at` (NULL ⇒ metadata+jsonl sucios), `crops_uploaded_at`
(NULL ⇒ crops sucios).

## Behavior

- **Metadata**: `sync_push.py` incluye los tres campos de clasificación en el
  payload de `recordings`; `receive_recordings` los hace upsert en insert y
  re-push (igual que `count`/`count_status`/`count_config`, que se computan
  después del primer sync).
- **Archivos (auto, LAN-gated)**: el loop de `upload_pending_recordings`, además
  del MP4 y el `{uuid}.jsonl` de detecciones, empuja — una grabación a la vez —
  el `{uuid}.classifications.jsonl` (+ `crossings.jsonl`) y los recortes JPG,
  **solo cuando**:
  1. la metadata ya está sincronizada (server resuelve la fila por uuid),
  2. el MP4 ya subió (`uploaded_at != None`) — porque el server deriva
     `crops_dir_for`/`classifications_path_for` de `file_path`, que solo se
     reescribe al path del server al recibir el MP4, y
  3. la clasificación no está en curso (`classification_status` ∉
     `{pending, classifying}` — el jsonl a medias es parcial), y el flag está
     sucio (`classifications_uploaded_at is None` / `crops_uploaded_at is None`).
- **Server receive**: cada endpoint guarda su blob en el path que le corresponde;
  el de `classifications` además transcribe el jsonl a filas
  `FruitCrop`/`FruitClassification` (misma lógica que el poller). Idempotente:
  borra los crops/clasificaciones previos de esa grabación antes de reinsertar.
- **Re-clasificación**: el poller ya pone `classifications_uploaded_at=None`; esta
  fase añade que también ponga `crops_uploaded_at=None`, para que los recortes
  regenerados se re-empujen. El botón de sync manual por sesión/grabación arrastra
  estos artefactos igual que hoy arrastra el sidecar de detecciones.
- **Fallo/reintentos**: un fallo se loguea pero deja el flag NULL (sucio) para
  reintentar en el siguiente ciclo; nunca bloquea el MP4 (artefacto primario).

## Decisions

- **No hay migración nueva.** La `022_categories_classification` ya creó las
  columnas (`classification_status/error/config`, `classifications_uploaded_at`,
  `crops_uploaded_at`) **y** las tablas `fruit_crops`/`fruit_classifications` en
  ambos modos. El server solo debe estar en `022` (head actual). El argumento
  original pedía "migración en el server" — quedó obsoleto al confirmar `022`.
- **El jsonl es la fuente de verdad; el server lo transcribe.** En lugar de
  serializar filas `FruitCrop`/`FruitClassification` en el payload, se sube el
  `{uuid}.classifications.jsonl` (patrón idéntico a `_upload_detections`) y el
  server corre la misma transcripción que el poller. Menos superficie de API y
  reusa código probado (`_transcribe_results`).
- **Transcripción compartida.** Se extrae el núcleo de
  `classification_poller._transcribe_results` a un módulo reutilizable
  (`classification_ingest.py`) que importan el poller (robot) y el receiver
  (server), para no duplicar la lógica jsonl→filas.
- **Crops = artefacto pesado, mismo flag-lifecycle pero endpoint aparte.** Se
  suben por su propio endpoint `.../crops/upload` (uno o varios JPG), gated por
  `crops_uploaded_at`, una grabación a la vez para no ahogar el sync de metadata
  en un enlace rural. Se reusa el gate LAN + streaming ya existente.
- **`crossings.jsonl` se sube por completitud, no para mostrar.** El
  `RipenessDialog` no lo necesita; se sube bajo el mismo flag para dejar al server
  capaz de re-clasificar en el futuro sin re-contar. Barato (mismo patrón).
- **Gate en `uploaded_at != None`.** Evita subir crops/jsonl antes que el MP4:
  el server necesita `file_path` ya reescrito a su `recordings_dir` para que
  `crops_dir_for` apunte al directorio correcto.

## Context

- See `spec/roadmap.md` — cierra el pipeline de clasificación diferida (conteo →
  clasificación → **sync**) empezado en `022`/PR #97/#98.
- Patrón a espejar: `src/back/services/sync_recordings_upload.py`
  (`_upload_detections`, `_sidecar_needs_upload`, `_push_sidecar_if_ready`,
  `upload_pending_recordings`) y el reset de flag en
  `counting_poller.py:101` (`detections_uploaded_at = None`).
- Receiver a espejar: `src/back/routes/sync.py` bloque `if config.mode ==
  AppMode.SERVER` (`upload_recording_blob`, `upload_recording_detections`).
- Transcripción a reusar: `classification_poller._transcribe_results`.
- Consumidores que ya funcionan en server (no se tocan):
  `routes/recordings.py::get_recording_classifications` y `get_recording_crop`.
