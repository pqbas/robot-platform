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
- numpy pinned `<1.24` y `np.bool/np.float/np.int/np.object` se monkey-patchean al inicio de `main.py`: el TensorRT 8.5 de JetPack referencia `np.bool` que NumPy 1.24+ removió; ver Phase 11.
- Per-frame timing: el worker mantiene un rolling window (600 frames) y loguea p50/p90/p99/mean cada 150 frames con breakdown por etapa (`pre`/`infer`/`post`). Snapshot on-demand: `make bench-inference`.
- Optimizar latencia es Phase 16 (`spec/29-04-26-inference-perf/`); el baseline actual es ~52 ms / 19 fps con `model.track()` en TRT FP16 a pesar de que la inferencia pura del modelo corre a 16 ms — el resto es overhead del wrapper de ultralytics. Pinear clocks (`sudo jetson_clocks`) es prerequisito antes de medir.

## Puertos
- Robot: `PORT=8080` (`.env.robot`)
- Server: `PORT=9090` (`.env.server`)
- Frontend dev: `5173` (proxy apunta a `localhost:8080`)

## Camera Worker
- Proyecto uv separado en `camera_worker/` con opencv-python y numpy
- El backend NO accede a V4L2 directamente — lee frames raw BGR del socket `/tmp/camera.sock`
- Protocolo: handshake JSON (width, height, channels, fps) + stream de frames length-prefixed
- **Fan-out**: el worker abre la cámara una sola vez y reparte cada frame a todos los clientes conectados (backend WebRTC + recording-worker simultáneos). Cola por cliente con drop-oldest si se atrasa.
- Default: captura ZED 2i estéreo SBS a 3840×1080@30 YUYV, crop al ojo izquierdo → frame de salida 1920×1080 BGR. Live WebRTC y recording sostienen 1080p@30 (NVENC en Jetson).
- Resolución activa: `data/robot/camera_settings.json` (`{"preset": "1080p" | "720p"}`). El operador la cambia desde el frontend (Vision); el backend pinguea `/tmp/camera-control.sock` (`{"cmd":"reload"}`) y el worker reabre V4L2. Si el JSON falta o es inválido, fallback a 1080p.
- Troubleshooting: si la red entre Jetson y operador es débil, cambiar a 720p desde el selector en /vision (no requiere SSH al robot).
- Iniciar worker: `make run-camera` o `cd camera_worker && uv run camera-worker`

## Recording Worker
- Proyecto uv separado en `recording_worker/` con `av` (PyAV) y opcionalmente `PyGObject` (extra `[gstreamer]`).
- El backend NO importa `av` ni `gi` — habla con el worker via Unix socket de control `/tmp/recording.sock` (JSON length-prefixed: `start`, `stop`, `status`).
- El worker se conecta al socket de cámara solo al recibir `start` (idle = 0 CPU, 0 NVENC, 0 conexión).
- Selección de backend automática: `nvv4l2h264enc` (Jetson, GStreamer) → `h264_nvenc` (desktop NVIDIA, PyAV) → `libx264` (CPU fallback).
- En Jetson el plugin `nvv4l2h264enc` viene de `nvidia-l4t-gstreamer` (JetPack); PyGObject solo no es suficiente — el deploy verifica los plugins con `gst-inspect-1.0` antes de habilitar la unidad.
- Iniciar worker: `make run-recording` o `cd recording_worker && uv run recording-worker`.
- Probar backend detectado: `cd recording_worker && uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"`.
- Bitrate auto-escalado por altura del frame (Phase 7 lo expondrá como env var): NVENC 12 Mbps a 1080p, 8 Mbps a 720p; libx264 9/6 Mbps respectivamente. Profile=High preset=Slow (NVENC); preset=medium crf=20 (libx264). El FPS se toma del handshake del camera-worker, no se hardcodea.

## Conversion Worker
- Proyecto uv separado en `conversion_worker/`. Construye TensorRT engines (`.pt` → FP16 `.engine`) bajo demanda. Idle = 0 CPU, 0 GPU.
- En Jetson el venv se crea con `uv venv --system-site-packages --python /usr/bin/python3` para heredar `tensorrt` de JetPack (`python3-libnvinfer`); el backend usa Python 3.13, así que el worker corre por separado.
- El backend habla via Unix socket `/tmp/conversion.sock` (JSON length-prefixed: `convert`, `status`); cliente en `back/services/perception/conversion_client.py`.
- Cache en `data/robot/models/<stem>.<file_hash>.fp16.engine` — el sha del `.pt` baked en el nombre invalida automáticamente cuando el AI engineer re-sube el modelo.
- El operador activa/desactiva TensorRT por modelo desde `/settings` (card "Modelos asignados", visible solo en modo robot). Una conversión a la vez (segunda → 409).
- Iniciar worker: `make run-conversion` o `cd conversion_worker && uv run conversion-worker`.

## Comandos
- Camera worker: `make run-camera`
- Inference worker: `make run-inference`
- Recording worker: `make run-recording`
- Conversion worker: `make run-conversion`
- Backend robot: `make run-robot` (o `ENV_FILE=.env.robot uv run python -m back.main`)
- Backend server: `make run-server` (levanta PostgreSQL + uvicorn)
- Frontend: `make run-front`

## Deploy (producción)
- Instalar robot: `make deploy-robot` (nginx + systemd, SQLite, port 8080)
- Instalar server: `make deploy-server` (nginx + systemd + PostgreSQL, port 9090)
- Logs backend: `make logs` | Logs inference: `make logs-inference` | Logs camera: `make logs-camera` | Logs recording: `make logs-recording` | Logs conversion: `make logs-conversion`
- Status: `make status` | Restart: `make restart`
- Nginx sirve `front/dist/` y hace proxy a uvicorn en 127.0.0.1
- Systemd ejecuta uvicorn directo (sin tmux), `Restart=on-failure`
- `.env.active` es symlink a `.env.robot` o `.env.server`

## Credenciales dev
- Server admin seed: `admin` / `admin`
