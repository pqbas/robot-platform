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

## Comandos
- Inference worker: `make run-inference`
- Backend robot: `make run-robot` (o `ENV_FILE=.env.robot uv run python -m back.main`)
- Backend server: `make run-server` (levanta PostgreSQL + uvicorn)
- Frontend: `make run-front`

## Deploy (producción)
- Instalar robot: `make deploy-robot` (nginx + systemd, SQLite, port 8080)
- Instalar server: `make deploy-server` (nginx + systemd + PostgreSQL, port 9090)
- Logs backend: `make logs` | Logs inference: `make logs-inference`
- Status: `make status` | Restart: `make restart`
- Nginx sirve `front/dist/` y hace proxy a uvicorn en 127.0.0.1
- Systemd ejecuta uvicorn directo (sin tmux), `Restart=on-failure`
- `.env.active` es symlink a `.env.robot` o `.env.server`

## Credenciales dev
- Server admin seed: `admin` / `admin`
