# Requirements: Session Detection Replay

## Scope

El operador puede abrir un popup desde la lista de sesiones que reproduce el video grabado con los bounding boxes de deteccion superpuestos, sincronizados frame a frame. Las sesiones sin grabacion asociada no muestran el boton.

## Inputs / Data

**Endpoint nuevo `GET /api/recordings/{uuid}/detections`:**

| Campo | Tipo | Notas |
|-------|------|-------|
| `fps` | float | FPS del video grabado, tomado de `Recording.fps` |
| `frames` | array | Array de objetos por frame, en orden de frame index |
| `frames[].frame` | int | Indice 0-based |
| `frames[].t` | float | Unix timestamp del frame |
| `frames[].dets` | array | Lista de detecciones (vacia si no hubo objetos) |
| `frames[].dets[].cls` | string | Clase detectada |
| `frames[].dets[].conf` | float | Confianza [0, 1] |
| `frames[].dets[].bbox` | [x1, y1, x2, y2] | Coordenadas normalizadas |
| `frames[].dets[].track_id` | int or null | ID de seguimiento |

**Campo nuevo `Session.recording_uuid`:** TEXT NULLABLE, seteado en `save_session` desde `_last_recording_uuid`.

## Behavior

- La tabla de sesiones muestra un icono de video en la fila cuando `session.recording_uuid != null`.
- Al hacer clic en ese icono se abre `DetectionReplayDialog` con un `<video>` y un `<canvas>` superpuesto.
- El `<canvas>` se redibuja en cada evento `timeupdate` del video: calcula `frameIdx = Math.floor(currentTime * fps)`, busca `frames[frameIdx]`, dibuja los bboxes normalizados escalados al tamano del canvas.
- El video se sirve directamente desde `/api/recordings/{uuid}/file` como `src` del elemento `<video>`.
- Si el archivo JSONL no existe (grabacion sin detecciones), el endpoint devuelve `{"fps": null, "frames": []}` y el popup muestra el video sin overlay.
- El popup es solo de lectura (no modifica datos).

## Decisions

- **`recording_uuid` en `Session` model (migracion)** en vez de query por solapamiento de timestamps: la FK directa es determinista y O(1); el solapamiento es heuristico y requiere una consulta adicional por sesion en la lista.
- **Respuesta JSON completa (no streaming NDJSON)** para el endpoint de detecciones: las grabaciones son acotadas (tipicamente 5-30 minutos a ~10 fps de inferencia = 3k-18k lineas, < 5 MB). Un array JSON simple es mas facil de consumir desde el frontend sin un parser de NDJSON.
- **Canvas overlay con `timeupdate`** en vez de `requestAnimationFrame`: `timeupdate` solo dispara cuando la posicion del video cambia, evitando redraws innecesarios cuando el video esta pausado. rAF seria necesario solo si se requiriera precision sub-frame.
- **`fps` de `Recording.fps`** para el mapeo `currentTime * fps`: ya lo almacena el recording-worker al detener; no es necesario derivarlo del JSONL.

## Context

- Patron de migracion: `back/alembic/versions/016_recording_camellon.py` (SQLite idempotente + PostgreSQL).
- Patron de endpoint de descarga: `back/routes/recordings.py`, `download_recording` (GET `/{uuid}/file`).
- Patron de schema: `back/schemas.py`, clase `SessionOut` (linea 54).
- Patron de dialog frontend: `front/src/modules/map/components/SessionEditDialog.tsx`.
- Patron de canvas overlay: aun no existe; la referencia mas cercana es `front/src/modules/vision/components/DetectionOverlay.tsx` si existe, o implementar desde cero con `useRef` sobre `<canvas>`.
- Roadmap: Phase 32 (este spec).
