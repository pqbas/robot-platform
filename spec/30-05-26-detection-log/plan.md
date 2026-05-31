# Plan: Detection Log

## Group 1: Detection Recorder (nuevo módulo)

1. Crear `back/services/detection_recorder.py` con:
   - `_state`: dataclass o dict con `uuid: str | None`, `file: IO | None`, `frame: int`, `lock: threading.Lock`
   - `start(uuid: str, recordings_dir: str) -> None`: abre `{recordings_dir}/{uuid}.jsonl` en modo `"w"`, resetea contador a 0.
   - `stop() -> None`: cierra el file handle si está abierto, limpia el estado.
   - `record(detections: list[DetectionItem]) -> None`: llamada thread-safe; escribe una línea JSONL con `frame`, `t` (time.time()), y `dets`; incrementa el contador. Si no hay grabación activa, retorna sin hacer nada.

---

## Group 2: Integrar en routes/recordings.py

2. En `back/routes/recordings.py`, importar `from back.services import detection_recorder`.

3. En `start_recording` (después de obtener `uuid` y antes del `db.add`):
   ```python
   detection_recorder.start(uuid, config.storage.recordings_dir)
   ```

4. En `stop_recording` (después de `worker_resp = _client().stop()`, antes del commit):
   ```python
   detection_recorder.stop()
   ```

---

## Group 3: Modificar condición de inferencia en camera.py

5. En `back/services/camera.py`, importar `from back.services import detection_recorder`.

6. En `_InferenceWorker._run()`, línea 82-83, cambiar la condición de skip:
   ```python
   # Antes:
   if not processing_enabled or session is None:
       continue
   # Después:
   recording_active = detection_recorder.is_active()
   if not processing_enabled or (session is None and not recording_active):
       continue
   ```

7. En `_InferenceWorker._run()`, después de `counter.update(tracking_data)` (línea 103), agregar:
   ```python
   detection_recorder.record(detections)
   ```
   Donde `detections` es la lista de dicts raw del response (antes de construir `DetectionItem`). El recorder serializa directamente los campos necesarios.

8. En el bloque `except Exception` (línea 116-126), agregar antes de asignar `error_payload`:
   ```python
   detection_recorder.record([])
   ```
   para mantener el índice de frames continuo aunque la inferencia falle.

---

## Group 4: Endpoint de descarga (opcional, baja prioridad)

9. En `back/routes/recordings.py`, agregar `GET /{uuid}/detections`:
   - Lee `{recordings_dir}/{uuid}.jsonl`, lo sirve como `application/x-ndjson`.
   - Retorna 404 si el archivo no existe.
   - Solo disponible en modo robot (igual que `GET /{uuid}/file`).
