# Robot Platform

## Arquitectura
- **Backend:** FastAPI en `back/`, un solo codebase para robot y server
- **Frontend:** React + TypeScript + Vite en `front/`
- **Modo:** controlado por `ROBOT_MODE` en `.env.robot` o `.env.server`

## Puertos
- Robot: `PORT=8080` (`.env.robot`)
- Server: `PORT=9090` (`.env.server`)
- Frontend dev: `5173` (proxy apunta a `localhost:8080`)

## Comandos
- Backend robot: `ENV_FILE=.env.robot uv run python -m back.main`
- Backend server: `PORT=8080 ENV_FILE=.env.server uv run python -m back.main` (o levantar PostgreSQL primero con `docker compose -f docker-compose.server.yml up -d`)
- Frontend: `cd front && npm run dev`

## Deploy (producción)
- Instalar robot: `make deploy-robot` (nginx + systemd, SQLite, port 8080)
- Instalar server: `make deploy-server` (nginx + systemd + PostgreSQL, port 9090)
- Logs: `make logs` | Status: `make status` | Restart: `make restart`
- Nginx sirve `front/dist/` y hace proxy a uvicorn en 127.0.0.1
- Systemd ejecuta uvicorn directo (sin tmux), `Restart=on-failure`
- `.env.active` es symlink a `.env.robot` o `.env.server`

## Credenciales dev
- Server admin seed: `admin` / `admin`
