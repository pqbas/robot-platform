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

### Specs / planning
- `spec/<fecha>-<feature>/{plan,requirements,validation}.md` — convención por feature.
- `spec/29-04-26-inference-perf/` — perf baselines.
- `spec/roadmap.md` — fases.

## Persistencia
- DB: SQLite (robot) / PostgreSQL (server).
- Camera settings: `data/robot/camera_settings.json`.
- TensorRT engines cache: `data/robot/models/`.

## Comandos
- Workers: `make run-{camera,inference,recording,conversion}`.
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
