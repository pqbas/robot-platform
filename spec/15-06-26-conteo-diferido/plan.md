# Plan: Conteo diferido (counting worker)

Rama de trabajo: `feat/conteo-diferido` desde `master` (este repo usa `master`,
no `dev`).

## Group 1: counting-worker (proyecto uv nuevo)

1. Crear `src/counting_worker/` como proyecto uv espejo de `src/conversion_worker/`:
   - `pyproject.toml` con deps `ultralytics`, `opencv-python` (decode MP4), numpy
     pin como el inference-worker (`<1.24` + monkey-patch np.bool/float/int/object).
   - `counting_worker/__init__.py`, `counting_worker/main.py`,
     `counting_worker/processor.py`, `counting_worker/object_counter.py`.

2. `counting_worker/object_counter.py`: copiar `ObjectCounter` tal cual desde
   `src/back/services/perception/object_counter.py` (geometría pura, sin torch).

3. `counting_worker/processor.py` — `count_video(payload) -> dict`:
   - `cv2.VideoCapture(video_path)`; iterar frames con índice 0-based.
   - Por frame: aplicar el mismo crop ROI que `detector.detect` (`roi_mode`
     square/full, ver detector.py:131-139), `YOLO(engine).predict(roi, conf, verbose=False)`.
   - Pasar las cajas al tracker ByteTrack (sin GMC): usar
     `model.track(roi, persist=True, tracker="bytetrack.yaml", conf=...)` para
     reusar el pipeline de ultralytics, o un `ByteTrack` directo si se prefiere
     no recargar el modelo. Mapear bbox/centroides a espacio de frame completo
     igual que detector.py:173-192.
   - Acumular cruces con `ObjectCounter.update(tracking_data)`.
   - Escribir una línea JSONL por frame en `jsonl_path` con el mismo esquema que
     `detection_recorder.record` (`{frame, t, dets:[{cls,conf,bbox,track_id}]}`),
     bbox normalizado [0,1] como en el replay.
   - Devolver `{ok, total_count: counter.get_count(), frames: n}`.

4. `counting_worker/main.py`: copiar la máquina de estados y el socket de control
   de `conversion_worker/main.py`, renombrando:
   - `cmd "count"` → valida `video_path`/`engine_path`, `busy` si hay thread vivo,
     lanza `_run_count` en thread daemon, devuelve `{ok, state:"counting"}`.
   - `cmd "status"` → `{state, current, last_result}` con
     `last_result = {ok, total_count, frames, duration_seconds, finished_at}`.
   - `--control-socket` default `os.getenv("COUNTING_SOCKET", "/tmp/counting.sock")`.

5. Makefile: agregar `run-counting` (espejo de `run-conversion`) y entradas en
   `logs-counting` / `status` / `restart`. Documentar el socket en `CLAUDE.md`
   (sección "Sockets Unix" y "Workers").

---

## Group 2: Backend — cliente, config, modelo, migración

6. `src/back/config.py`: agregar `CountingWorkerConfig` con
   `control_socket_path = os.getenv("COUNTING_SOCKET", "/tmp/counting.sock")` y
   registrarlo en `Config` (`counting_worker: CountingWorkerConfig`). (Nota: ya
   existe `CountingConfig` para mode/threshold/direction — no confundir.)

7. `src/back/services/perception/counting_client.py`: copiar
   `conversion_client.py` → `CountingClient` con `count(...)` y `status()`,
   excepción `CountingWorkerUnavailable`.

8. `src/back/models.py`: añadir a `Recording` las columnas `count_status`
   (Text, default `'none'`), `count` (Integer, nullable), `count_error` (Text,
   nullable), `count_config` (Text, nullable).

9. Migración Alembic en `src/back/alembic/versions/`: `add count fields to
   recordings` (4 columnas, todas con server_default/ nullable para no romper
   filas existentes).

10. `src/back/schemas.py`: extender `RecordingOut` con `count_status`, `count`,
    `count_error`; y `SessionOut` con `count_status`/`count` derivados del
    recording vinculado (para que la lista de sesiones muestre "procesando").

---

## Group 3: Backend — disparo, poller, endpoints

11. `src/back/routes/counting.py::stop_counting`: tras `stop_recording(db)` ok,
    construir el `count_config` snapshot desde `config.counting`
    (mode/threshold/direction/roi_mode/confidence) + `target_class`, **más la
    identidad del modelo activo**: leer el `DetectionModel` con `is_active=True`
    y fijar `model_uuid`, `model_version` (su `version`), `file_hash` y
    `engine_path` (vía `engine_paths.resolve_model_path(...)`). Persistir el
    snapshot en el `Recording` (`count_config`, `count_status='counting'`) y
    llamar `CountingClient.count(...)` con ese `engine_path`. Si no hay modelo
    activo o el worker no está disponible, marcar `count_status='error'` con el
    motivo y seguir (no abortar el stop).

12. `src/back/services/perception/counting_poller.py`: copiar
    `conversion_poller.py`:
    - `reconcile_orphaned_counts()` — al startup, `Recording` en `counting`:
      re-encolar si el MP4 **y el `engine_path` del `count_config`** existen en
      disco; si falta el MP4 o el engine (`file_hash` ya no cacheado) marcar
      `error` con el motivo (no contar con un modelo equivocado en silencio).
    - `run_poller()` — mientras haya `Recording` en `counting`, poolear
      `status()`; en `last_result` ok → `count_status='done'`, `count=total_count`,
      y backfill de `Session.total_count` donde `Session.recording_uuid == uuid`;
      error → `count_status='error'`.

13. `src/back/main.py`: registrar `reconcile_orphaned_counts()` en el lifespan
    startup y lanzar `run_poller()` como task de fondo (junto al de conversión).

14. `src/back/routes/recordings.py`: endpoint
    `POST /{uuid}/recount?use_active_model=false` — lee el `Recording`, valida
    `ended_at` no nulo y MP4 en disco. Por defecto reproduce: re-encola con el
    `count_config` persistido (mismo `engine_path` fijado) — 409 si ese engine
    ya no está cacheado. Con `use_active_model=true`: re-snapshotea la identidad
    del `DetectionModel` activo en `count_config` y re-encola con ese engine.
    Marca `count_status='counting'`. 404 si el uuid no existe, 409 si el MP4 (o
    el engine requerido) falta.

---

> **División en dos fases (decisión 15-06-26).** Esta rama implementa los Grupos
> 1–3 y un Grupo 5 recortado. El **Grupo 4 (desmontaje del live) se difiere a una
> fase 2** para no mezclar el riesgo del worker nuevo con tocar el camino que ya
> funciona. En fase 1 el live sigue **igual que hoy** (track + counter +
> detection_recorder); el conteo offline es el autoritativo (el poller hace
> backfill de `Session.total_count`) y se valida presencialmente antes de retirar
> el live en fase 2.

## Group 4: Live path — overlay visual sin contar — **FASE 2 (rama `conteo-vivo-desmontaje`)**

> **Revisión 18-06-26 (al implementar fase 2).** El spec original subestimó la
> superficie: `session_total` se emite por **tres** transportes (no solo el
> data-channel WebRTC) y el frontend lo consume en **cuatro** archivos. El
> `detection_recorder` y el worker escriben el **mismo** `{uuid}.jsonl` →
> **decisión: quitar `detection_recorder` del todo** (las grabaciones sin sesión
> de conteo quedan sin replay; en la práctica siempre se cuenta al grabar). El
> número en vivo (`CountOverlay`, 6xl) se retira: el overlay queda visual (cajas
> + "● grabando") y el número final lo da el conteo offline en la lista.

15. `src/inference_worker/inference_worker/detector.py::detect`: cambiar
    `self._model.track(roi, persist=True, ...)` por `self._model.predict(roi, ...)`
    (sin tracker → recupera el cuello del GMC). Quitar la construcción de
    `tracking_data` y el campo del retorno; seguir devolviendo `detections`
    (mapeadas a frame completo) para el overlay.

16. `src/back/services/camera.py::_InferenceWorker._run`: quitar
    `counter.update(tracking_data)` y `detection_recorder.record(...)`; dejar de
    setear `session_total` en el `FrameDetectionPayload`. `needs_inference` pasa a
    depender **solo** de `counter.get_active_session()` (ya no de
    `detection_recorder.is_active()`). Mantener el envío de `detections`.

17. `src/back/services/perception/counter.py`: la sesión en memoria sigue siendo
    el marcador de "hay conteo activo" (dispara recording + needs_inference),
    pero se retira `ObjectCounter`: `update()` queda no-op/eliminada,
    `last_frame_count` ya no se actualiza. Revisar imports en `counting.py`.

18. **Tres transportes** dejan de inyectar `session_total`:
    - `src/back/services/camera.py` (data-channel WebRTC) — paso 16.
    - `src/back/services/stream_broadcaster.py` (MJPEG WS) — header línea ~163/172/178.
    - `src/back/services/wc_broadcaster.py` (WebCodecs WS) — header línea ~173/186/192.
    Quitar `session_total` del header (o dejarlo fijo en 0 si el frontend aún lo
    lee transitoriamente). Mantener `detections`/`session_active` para el overlay.

19. **Eliminar `detection_recorder`**: borrar `src/back/services/detection_recorder.py`
    y sus usos: `camera.py` (`record`/`is_active`), `recordings.py`
    (`start`/`stop` en start/stop_recording). El sidecar lo genera el worker.
    Quitar `session_total` de `FrameDetectionPayload` en `schemas.py`.

---

## Group 5: Frontend — estado "procesando" y conteo final

> Paso 21 (lista de sesiones) ya se entregó en **fase 1**. Pasos 20–24 (retirar el
> número en vivo) son **fase 2**, rama `conteo-vivo-desmontaje`.

20. *(fase 2)* `src/front/src/types/index.ts`: quitar `session_total` de
    `FrameData` (el backend ya no lo emite).

21. **(fase 1 — hecho)** Lista de sesiones: estado del conteo offline +
    botón "Re-contar" → `POST /api/recordings/{uuid}/recount`.

22. *(fase 2)* `src/front/src/hooks/useCounting.ts`: retirar `sessionTotal`/
    `lastFrameCount` como número en vivo (`updateFrame` ya no lo setea desde el
    payload). `stopCounting`/`save` no dependen de un total en vivo (se guarda
    con 0 y el poller hace backfill de `Session.total_count`).

23. *(fase 2)* `src/front/src/hooks/useMjpegStream.ts` y `useWebCodecsStream.ts`:
    dejar de leer `header.session_total`; `src/front/src/lib/streamFraming.ts`:
    quitar `session_total` del tipo del header.

24. *(fase 2)* Overlay y guardado:
    - `CountOverlay.tsx` / `VisionPage.tsx`: retirar el número 6xl en vivo; el
      overlay queda visual (cajas + indicador "● grabando").
    - `SaveDialog.tsx`: mostrar "Procesando conteo…" en vez de un número (el
      número final aparece en la lista de sesiones vía backfill).

25. **(fase 1 — hecho)** `DetectionReplayDialog`: pinta las cajas alineadas al
    consumir el JSONL regenerado por el worker (solo validación visual).
