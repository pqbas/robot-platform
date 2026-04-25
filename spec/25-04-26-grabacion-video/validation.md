# Validation: Grabación de video

Implementación lista para mergear cuando todas las cajas siguientes pasan.

## Automated Tests

- [ ] `cd back && uv run alembic upgrade head` aplica migración 008 sin errores en SQLite (robot) y PostgreSQL (server).
- [ ] `cd back && uv run pytest` exits 0 (los tests existentes no se rompen; este phase no añade unit tests por dependencia de cámara real).
- [ ] `cd recording_worker && uv sync` crea el venv base sin errores (laptop dev).
- [ ] `cd recording_worker && uv sync --extra gstreamer` crea el venv en Jetson sin errores.
- [ ] `cd recording_worker && uv run python -c "import av, numpy"` exits 0 (deps base).
- [ ] `cd recording_worker && uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"` imprime el backend detectado: `nvv4l2h264enc` en Jetson, `h264_nvenc` o `libx264` en dev.
- [ ] `cd front && npx tsc --noEmit` exits 0.

### Specific test coverage required

- [ ] `POST /api/recordings/start` con grabación ya activa devuelve 409.
- [ ] `POST /api/recordings/stop` sin grabación activa devuelve 409.
- [ ] `POST /api/recordings/start` con `recording-worker` apagado devuelve 503 con mensaje claro (worker unavailable), no crash.
- [ ] `GET /api/recordings/{uuid}/file` con uuid inexistente devuelve 404.
- [ ] `GET /api/recordings/{uuid}/file` con archivo borrado del disco pero fila viva devuelve 404 (no crash).
- [ ] `DELETE /api/recordings/{uuid}` borra fila Y archivo (verificar con `ls`).
- [ ] `POST /api/sync/recordings/{uuid}/upload` con `uploaded_at` ya set devuelve 409.
- [ ] `receive_recordings` con `session_uuid` que no resuelve en server **acepta** la grabación (no falla — asociación informativa).
- [ ] `sync_push.push_all` incluye `recordings` en el log de queue summary.

## Manual Checks

### Worker isolation

- [ ] `make run-camera` + `make run-recording` con dos clientes simultáneos (backend WebRTC + recording-worker): ambos reciben frames sin que uno bloquee al otro.
- [ ] `kill -9 <pid recording-worker>` durante una grabación: backend sigue respondiendo, systemd reinicia el worker, próximo `POST /api/recordings/start` funciona.
- [ ] `kill -9 <pid camera-worker>` durante una grabación: recording-worker detecta el cierre del socket, finaliza el MP4 (queda reproducible), vuelve a idle.
- [ ] Backend FastAPI **no** importa nuevas deps de encoding directamente — `recording_client.py` sólo habla por socket (verificar con `grep -rn "import av\|import gi\|gst-launch" back/services/recording_client.py back/routes/recordings.py` → vacío).

### Performance en Jetson

- [ ] Mientras graba: `tegrastats` muestra NVENC con utilización (no idle). `top` muestra el recording-worker en <20% de un core (videoconvert es el costo principal; si supera, investigar path NVMM).
- [ ] WebRTC FPS reportado en VisionPage no cae más de 1-2 FPS durante grabación activa simultánea.
- [ ] YOLO inference FPS (badge en VisionPage) se mantiene igual con y sin grabación activa (NVENC no comparte cores con CUDA).

### Flujo operador

- [ ] Click "Grabar" en VisionPage con cámara conectada → badge "REC ●" parpadeante y timer aparecen.
- [ ] Click "Detener grabación" después de 30s → toast con duración (~30s) y tamaño (>0 MB).
- [ ] `/recordings` lista la grabación con estado "pendiente" (sin sync configurado).
- [ ] Descargar el MP4 → abre en VLC y reproduce ~30s sin corrupción.
- [ ] Iniciar conteo, después grabación → la grabación queda con `session_uuid` igual al de la sesión activa.
- [ ] Iniciar grabación sin conteo → fila guarda `session_uuid = null`.
- [ ] Detener conteo (con dialog de save) mientras graba → la grabación sigue activa hasta que el operador la detiene aparte.
- [ ] Refresh del browser durante una grabación: VisionPage recupera el estado y muestra el botón "Detener grabación".
- [ ] Borrar una grabación → desaparece de la lista y `data/robot/recordings/<uuid>.mp4` no existe.

### Sync end-to-end

- [ ] Server local arriba, `SYNC_INTERVAL=30` en `.env.robot`. Grabar 10s, esperar 1 ciclo: fila aparece en server con estado uploaded.
- [ ] Bloquear conexión robot↔server, grabar 10s: fila local tiene `uploaded_at = null`. Restaurar conexión, esperar 1 ciclo: queda subida.
- [ ] Server: descargar el MP4 desde su `/recordings` → mismo archivo que el local (comparar `md5sum`).

## Post-deploy Checks

- [ ] Tras `make deploy-robot`: `systemctl status recording-worker.service` → active (running), sin errores en `journalctl -u recording-worker`.
- [ ] `journalctl -u recording-worker` al arranque muestra `Recording worker — backend=nvv4l2h264enc` (Jetson) — confirmando que se detectó NVENC y no cayó al fallback CPU.
- [ ] `systemctl status camera-worker.service` → active (running) con el refactor de fan-out: dos clientes pueden conectarse sin que uno bloquee al otro.
- [ ] Disco del Jetson tiene >5GB libres en `/`.
- [ ] Tras deploy en server: PostgreSQL muestra la tabla `recordings` (`\d recordings`).

## Rollback Criteria

Hacer rollback si: (a) el refactor de fan-out de `camera_worker` introduce drops de FPS visibles en el WebRTC del operador, (b) el `recording-worker` consume tanto CPU que degrada la inferencia (>20% drop de FPS de YOLO), o (c) el upload de blobs satura la red rural y rompe el sync de metadata. Rollback = revert del merge + `alembic downgrade -1` (008 → 007) + deshabilitar `recording-worker.service`.

## Definition of Done

Todas las cajas arriba marcadas, branch rebaseado contra `master` sin conflictos, sin `console.log`/`print` de debug ni TODOs en código nuevo, y la grabación + conteo simultáneo verificada al menos una vez en hardware real (Jetson + ZED) durante una sesión de >2 minutos.
