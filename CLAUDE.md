# Robot Platform

## Topología
- Backend FastAPI: `back/` (un solo codebase, modo robot/server por `ROBOT_MODE` en `.env.{robot,server}`).
- Frontend React + Vite: `front/` (dev en `:5173`, proxy a `localhost:8080`).
- Workers uv separados (Unix socket): `camera_worker/`, `inference/`, `recording_worker/`, `conversion_worker/`.
- Puertos: robot `8080`, server `9090`.

## Invariantes
- Backend NO importa `ultralytics`, `torch`, `av`, `gi`, `cv2`. Esos viven en workers.
- Inference worker: NumPy `<1.24` + monkey-patch de `np.bool/np.float/np.int/np.object` (TensorRT 8.5 los referencia). Ver `inference/inference_worker/main.py`.
- Camera worker: una sola apertura V4L2, fan-out a todos los clientes (drop-oldest por cliente).
- WebRTC: `RTCPeerConnection` sin ICE servers → solo host candidates (asume LAN/localhost).

## Sockets Unix
- `/tmp/camera.sock` — frames raw BGR. Control: `/tmp/camera-control.sock`.
- `/tmp/inference.sock` — JPEG → JSON detecciones.
- `/tmp/recording.sock` — control start/stop/status.
- `/tmp/conversion.sock` — control convert/status.
- `/tmp/counting.sock` — control count/status (conteo diferido offline).

## Archivos clave

### Backend
- `back/main.py` — entry point, wiring, lifespan.
- `back/config.py` — env loading.
- `back/models.py` / `back/schemas.py` / `back/services/storage.py` — DB models, Pydantic, CRUD.
- `back/alembic/versions/` — migraciones.
- `back/routes/README.md` — contrato de auth (público vs privado).
- `back/middleware/server_auth.py` + `back/services/auth_guard.py` + `back/services/auth.py` + `back/services/lockout.py` — auth.
- `back/services/rate_limit.py` — rate limiting.
- `back/services/sync_*.py` + `back/routes/sync.py` — sync robot ↔ server.

### Stream / WebRTC
- `back/routes/stream.py` — endpoint `/offer`, peer connection.
- `back/services/camera.py` + `back/services/camera_client.py` — track de cámara.
- `back/services/nvenc_codec.py` — encoder H264 (PyAV NVENC / GStreamer / libx264) + bitrate live.
- `front/src/hooks/useWebRTC.ts` — cliente, freeze detector, reconnect.
- Bitrate real lo clampa `aiortc/codecs/h264.py` (REMB ajusta dinámicamente).
- Spec resiliencia: `spec/09-05-26-streaming-resiliente/`.

### Perception
- `back/services/perception/counter.py` — estado global de sesión (in-memory).
- `back/services/perception/object_counter.py` — line-crossing / ROI.
- `back/services/perception/inference_client.py` — cliente al worker.
- `back/services/perception/conversion_client.py` + `conversion_poller.py` + `engine_paths.py` — TensorRT.
- `back/routes/counting.py` — endpoints `/api/counting/*` + `/api/sessions/*`.
- `back/routes/config_routes.py` — config de counting (mode, threshold, direction).

### Workers
- `camera_worker/camera_worker/main.py` — V4L2, presets, handshake, fan-out.
- `inference/inference_worker/main.py` + `detector.py` + `protocol.py` — inferencia + timing.
- `recording_worker/recording_worker/encoder.py` — bitrate/preset/profile por backend.
- `conversion_worker/conversion_worker/main.py` + `converter.py` — `.pt` → FP16 `.engine`.
- `counting_worker/counting_worker/main.py` + `processor.py` + `object_counter.py` — conteo diferido: reprocesa el MP4 (detect + ByteTrack + cruce de línea) → conteo + sidecar `{uuid}.jsonl` alineado.

### Specs / planning
- `spec/<fecha>-<feature>/{plan,requirements,validation}.md` — convención por feature.
- `spec/29-04-26-inference-perf/` — perf baselines.
- `spec/roadmap.md` — fases.

## Persistencia
- DB: SQLite (robot) / PostgreSQL (server).
- Camera settings: `data/robot/camera_settings.json`.
- TensorRT engines cache: `data/robot/models/`.

## Comandos
- Workers: `make run-{camera,inference,recording,conversion,counting}`.
- Backend: `make run-{robot,server}`. Frontend: `make run-front`.
- Deploy: `make deploy-{robot,server}`. Update: `make update`.
- Logs: `make logs[-{inference,camera,recording,conversion}]`. Status/restart: `make {status,restart}`.
- Benchmarks: `make bench-inference`. Prereq Jetson: `sudo jetson_clocks`.

## Deploy
- Nginx sirve `front/dist/` + proxy a uvicorn `127.0.0.1`.
- Systemd ejecuta uvicorn directo (`Restart=on-failure`).
- `.env.active` symlink a `.env.{robot,server}`.

## Dev
- Server admin seed: `admin` / `admin`.

## Pendientes (server containerizado .67)
1. **Password de Postgres desalineada (volumen restaurado).** `POSTGRES_PASSWORD` en `.env.server` NO coincide con la password real del rol `platform` (el compose deriva `DATABASE_URL` de `POSTGRES_PASSWORD`). El `back-1` actual conecta porque arrancó con la password vieja en su entorno; `docker compose run/up back` (contenedor nuevo) falla con `InvalidPasswordError`. **Antes de recrear contenedores** hay que re-alinear (`ALTER ROLE platform PASSWORD ...` vía `\getenv`, o ajustar `POSTGRES_PASSWORD`) o el server se cae. Ver `memory/postgres-volume-restore-password.md`.
2. **Video 2.17 GB atascado (`1fdfc114-1a4d-426c-a184-ff458081b2b4`).** La migración `019` (file_size_bytes → BIGINT) ya está aplicada, pero el robot dejó de empujarlo (~17:04 del 20-jun): lo tiene marcado en su `sync_log` local como sincronizado aunque nunca llegó al server. El fix BIGINT no lo sube solo — hay que **forzar re-push desde el robot** (borrar su entrada en `sync_log` o usar el botón de sync manual). Robot en `192.168.50.103:80`.
