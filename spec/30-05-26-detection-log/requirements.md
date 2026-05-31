# Requirements: Detection Log

## Scope

Cuando hay una grabación activa, cada frame procesado por el inference worker genera una línea JSONL en `data/robot/recordings/{uuid}.jsonl`, con el número de frame, timestamp y los bounding boxes detectados. El archivo se cierra al detener la grabación. No hay cambios en la UI en esta fase.

## Inputs / Data

Cada línea del JSONL tiene la siguiente estructura:

| Campo | Tipo | Notas |
|-------|------|-------|
| `frame` | int | Índice 0-based, se incrementa por cada llamada al inference worker durante la grabación |
| `t` | float | Unix timestamp (segundos) en el momento del frame, referencia secundaria para depuración |
| `dets` | array | Lista de detecciones; vacío si no hay objetos en el frame |
| `dets[].cls` | string | Nombre de la clase detectada (`class_name` de `DetectionItem`) |
| `dets[].conf` | float | Confianza [0, 1] |
| `dets[].bbox` | [x1, y1, x2, y2] | Coordenadas normalizadas, mismo formato que `DetectionItem.bbox` |
| `dets[].track_id` | int or null | ID de seguimiento del objeto |

## Behavior

- La inferencia se activa cuando hay una grabación activa O una sesión de conteo activa (actualmente solo corre con sesión de conteo).
- Si hay grabación activa, el recorder escribe cada resultado de inferencia al archivo JSONL. Si la inferencia falla un frame (error de worker), se escribe una línea con `dets: []` para mantener el índice de frames continuo.
- Si no hay sesión de conteo activa pero sí grabación, la inferencia igual corre (para poder generar el log).
- Al llamar `stop_recording`, el archivo se cierra y el contador de frames se resetea.
- Si el archivo JSONL ya existe al iniciar (raro, UUID es nuevo cada vez), se sobreescribe.

## Decisions

- **JSONL (una detección-set por línea) en vez de JSON array**: el archivo puede crecer durante horas; JSONL permite escritura incremental sin mantener el array abierto en memoria ni corromper el archivo si el proceso termina abruptamente.
- **Frame number como índice primario, timestamp como secundario**: el frame number es determinístico (entero, 0-based); el timestamp es útil para depuración pero no es el identificador canónico de sincronización.
- **Módulo separado `detection_recorder.py`**: mantiene el file handle y el contador de frames fuera de `camera.py` y `recordings.py`, que ya tienen responsabilidades claras. Facilita testing unitario.
- **Inferencia corre cuando hay grabación activa aunque no haya conteo**: gravar sin detecciones sería inútil para el log. La penalización de CPU ya existía cuando había conteo activo; este cambio la extiende al caso de solo grabación.
- **No hay endpoint de descarga del JSONL en esta fase**: la sincronización y el acceso remoto al archivo se planifican en una fase posterior.

## Context

- Patrón de inferencia existente: `back/services/camera.py`, clase `_InferenceWorker._run()` (líneas 70-126).
- Patrón de estado de grabación: `back/routes/recordings.py`, `start_recording` y `stop_recording`.
- Schema de detecciones: `back/schemas.py`, clase `DetectionItem` (línea 114).
- Directorio de grabaciones: `config.storage.recordings_dir` (mismo que los MP4).
