# Robot Platform

## Arquitectura
- **Backend:** FastAPI en `back/`, un solo codebase para robot y server
- **Inference Worker:** proceso independiente en `inference/`, se comunica con el backend via Unix socket (`/tmp/inference.sock`)
- **Frontend:** React + TypeScript + Vite en `front/`
- **Modo:** controlado por `ROBOT_MODE` en `.env.robot` o `.env.server`

## Inference Worker
- Proyecto uv separado en `inference/` con sus propias dependencias (ultralytics, torch)
- El backend NO importa ultralytics/torch — envia JPEG frames al worker y recibe JSON con detecciones
- Protocolo: length-prefixed sobre Unix socket (header_len + jpeg_len + header JSON + JPEG bytes)
- En Jetson: Python 3.10 con PyTorch NVIDIA (CUDA). En laptop: Python 3.13 con PyTorch de PyPI
- Iniciar worker: `make run-inference` o `cd inference && uv run inference-worker --model ../yolo11n.pt`

## Puertos
- Robot: `PORT=8080` (`.env.robot`)
- Server: `PORT=9090` (`.env.server`)
- Frontend dev: `5173` (proxy apunta a `localhost:8080`)

## Camera Worker
- Proyecto uv separado en `camera_worker/` con opencv-python y numpy
- El backend NO accede a V4L2 directamente — lee frames raw BGR del socket `/tmp/camera.sock`
- Protocolo: handshake JSON (width, height, channels) + stream de frames length-prefixed
- **Fan-out**: el worker abre la cámara una sola vez y reparte cada frame a todos los clientes conectados (backend WebRTC + recording-worker simultáneos). Cola por cliente con drop-oldest si se atrasa.
- Iniciar worker: `make run-camera` o `cd camera_worker && uv run camera-worker`

## Recording Worker
- Proyecto uv separado en `recording_worker/` con `av` (PyAV) y opcionalmente `PyGObject` (extra `[gstreamer]`).
- El backend NO importa `av` ni `gi` — habla con el worker via Unix socket de control `/tmp/recording.sock` (JSON length-prefixed: `start`, `stop`, `status`).
- El worker se conecta al socket de cámara solo al recibir `start` (idle = 0 CPU, 0 NVENC, 0 conexión).
- Selección de backend automática: `nvv4l2h264enc` (Jetson, GStreamer) → `h264_nvenc` (desktop NVIDIA, PyAV) → `libx264` (CPU fallback).
- En Jetson el plugin `nvv4l2h264enc` viene de `nvidia-l4t-gstreamer` (JetPack); PyGObject solo no es suficiente — el deploy verifica los plugins con `gst-inspect-1.0` antes de habilitar la unidad.
- Iniciar worker: `make run-recording` o `cd recording_worker && uv run recording-worker`.
- Probar backend detectado: `cd recording_worker && uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"`.

## Comandos
- Camera worker: `make run-camera`
- Inference worker: `make run-inference`
- Recording worker: `make run-recording`
- Backend robot: `make run-robot` (o `ENV_FILE=.env.robot uv run python -m back.main`)
- Backend server: `make run-server` (levanta PostgreSQL + uvicorn)
- Frontend: `make run-front`

## Deploy (producción)
- Instalar robot: `make deploy-robot` (nginx + systemd, SQLite, port 8080)
- Instalar server: `make deploy-server` (nginx + systemd + PostgreSQL, port 9090)
- Logs backend: `make logs` | Logs inference: `make logs-inference` | Logs camera: `make logs-camera` | Logs recording: `make logs-recording`
- Status: `make status` | Restart: `make restart`
- Nginx sirve `front/dist/` y hace proxy a uvicorn en 127.0.0.1
- Systemd ejecuta uvicorn directo (sin tmux), `Restart=on-failure`
- `.env.active` es symlink a `.env.robot` o `.env.server`

## Credenciales dev
- Server admin seed: `admin` / `admin`
