# Tech Stack

## Infrastructure

- Cloud provider? None — self-hosted en hardware propio
- IaC? None
- Compute model? Bare metal — servicios systemd
- Container orchestration? None — Docker solo para PostgreSQL en servidor
- Deployment targets? Jetson Xavier NX (robot, SQLite) + PC laboratorio (servidor, PostgreSQL)

## Backend

- Language? Python 3.13
- Runtime? CPython
- Web framework? FastAPI
- Package / env manager? uv
- Video streaming? WebRTC via aiortc
- Database ORM? SQLAlchemy (async)
- Migrations? Alembic
- Auth? JWT propio via python-jose + bcrypt

## Inference Worker

Proceso separado con su propio entorno uv. Se comunica con el backend via Unix socket (`/tmp/inference.sock`) usando un protocolo length-prefixed.

- Language? Python 3.8+ (3.8 en Jetson, 3.13 en laptop)
- Object detection? YOLO via ultralytics
- Tracking? BotSort (integrado en ultralytics)
- Hardware target? NVIDIA Jetson Xavier NX — CUDA 11.4 (campo) / CPU (laptop)

## Data

- Robot (campo)? SQLite via aiosqlite
- Servidor (lab)? PostgreSQL via asyncpg
- Object storage? None — archivos locales en disco
- Cache? None
- Vector database? None

## AI / ML

- LLM? None
- Computer vision? YOLO (ultralytics) — detección y tracking de objetos
- Counting? Cruce de línea sobre tracking data (LIST_0 / LIST_1)

## Frontend

- Rendering model? SPA
- Framework? React 19 + Vite
- Language? TypeScript
- Styling? Tailwind CSS v4
- Component library? shadcn/ui (Radix)
- Charts? Recharts
- Maps? Google Maps via @googlemaps/js-api-loader
- Routing? React Router v6
- Forms? HTML nativo + estado local
- Build tool? Vite

## APIs

- Internal API style? REST (FastAPI)
- Video? WebRTC (offer/answer via HTTP, stream via peer connection + data channel)
- Inference? Unix socket (protocolo binario length-prefixed, no HTTP)
- GraphQL? No

## Auth

- Identity provider? None — self-hosted
- Session handling? JWT propio, roles: admin / operator
- Client SDK? None — fetch nativo con token en localStorage
