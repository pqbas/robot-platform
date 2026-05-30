# Requirements: Containerize server

## Scope

Empaquetar el modo `server` de robot-platform en contenedores reproducibles
levantados con un solo `docker compose up` desde un host limpio con la única
dependencia de Docker (Linux, Windows o macOS). El servidor actualmente
corre como tres procesos coordinados a mano (uvicorn vía systemd, nginx del
host, Postgres ya en compose) más Tailscale instalado en el host para
Funnel. Esta fase entrega:

- `Dockerfile` para `back/` (FastAPI server-mode, puerto 9090 interno).
- `Dockerfile` multi-stage para `front/` (build Vite → assets estáticos
  servidos por nginx).
- `nginx` como servicio compose que termina HTTP/HTTPS, sirve los estáticos y
  proxea a `back`.
- `tailscale` como servicio sidecar en compose, en modo userspace, que
  publica el Funnel y entrega los certs TLS al `nginx` vía volumen
  compartido.
- `docker-compose.server.yml` extendido con `back`, `front` (build target),
  `nginx` y `tailscale`, además del `postgres` existente.

Quedan fuera de esta fase: workers (no aplican al server), modo `robot`,
registry push, y la decisión de retirar `deploy/robot-platform.service`.

## Inputs / Data

| Variable | Origen | Notas |
|---|---|---|
| `ROBOT_MODE=server` | `.env.server` | montado en `back` container |
| `PORT=9090` | hardcoded en compose | puerto interno del back, no expuesto al host |
| `DATABASE_URL` | `.env.server` | apunta al hostname `postgres` de la red compose |
| `JWT_SECRET`, `ALLOWED_ORIGINS`, demás secrets | `.env.server` | el repo no commitea `.env.server` |
| `MODELS_DIR`, `FRAMES_DIR`, `RECORDINGS_DIR` | volúmenes named | persistencia fuera del container |
| `TS_AUTHKEY` | `.env.server` | reusable auth key generado en admin de Tailscale |
| `TS_HOSTNAME` | `.env.server` | nombre del nodo en la tailnet (ej. `robot-server`) |
| TLS certs | volumen `ts-state` compartido entre `tailscale` y `nginx` | generados por el sidecar, no por el host |
| `SERVER_NAME` | env del container nginx | derivado de `TS_HOSTNAME` + tailnet, expuesto por el sidecar |

## Behavior

- `docker compose -f docker-compose.server.yml up -d` levanta cinco
  servicios: `postgres`, `back`, `front` (build-only, exit 0 al copiar
  dist), `nginx` y `tailscale`.
- `back` espera a `postgres` healthy antes de arrancar; uvicorn corre en
  primer plano para que Docker maneje el restart.
- `tailscale` arranca primero, se autentica con `TS_AUTHKEY`, levanta el
  Funnel en `:443`, y emite los certs TLS a `/var/lib/tailscale/certs`
  dentro de su FS, expuesto al `nginx` vía volumen named `ts-state`.
- `nginx` sirve `front/dist` montado desde el stage de build de `front`,
  hace proxy a `back:9090`, escucha en `:80` y publica ese puerto al host
  (acceso LAN sin TLS). TLS lo termina `tailscaled` para el path público.
- Migraciones Alembic corren como `docker compose run --rm back alembic
  upgrade head` (one-shot), no en el entrypoint del servicio.
- `make deploy-server` queda intacto en esta fase. El nuevo flujo containerizado
  se documenta como alternativa en `deploy/README.md`.

## Decisions

- **Tailscale corre como sidecar container, no en el host.** Objetivo
  declarado de la fase: que el modo server sea instalable en cualquier OS
  con solo Docker. El sidecar usa `tailscale/tailscale` oficial en modo
  userspace (`TS_USERSPACE=true`) con `cap_add: NET_ADMIN` y un volumen
  named `ts-state` para persistir identidad y certs. nginx consume los
  certs del mismo volumen.
- **Funnel se habilita desde el sidecar.** El container expone `:443/tcp`
  vía `tailscale funnel` al arrancar (env `TS_SERVE_CONFIG` o comando
  explícito en el entrypoint). El bypass del Funnel hacia `nginx` interno
  va por la red de compose, no por el host.
- **Migraciones como `compose run --rm`, no en entrypoint.** Evita race
  conditions en restarts múltiples y permite correr la migración fuera del
  ciclo de vida del servicio (rollback, dry-run).
- **`front` como build-stage, no servicio runtime.** El frontend es estático
  post-build, no necesita un container vivo. El stage de build expone
  `/dist` que `nginx` consume vía volumen anónimo compartido en compose.
- **Backend mantiene `opencv-python` como dep aunque no lo importe en server
  mode.** Está en `pyproject.toml` raíz y removerlo requiere split del
  paquete, fuera de alcance. La imagen pagará el costo en tamaño.
- **Sin Dockerfile para workers.** Confirmado con el usuario: el servidor es
  back + front + nginx. Workers (camera, inference, recording, conversion)
  corren solo en el robot.
- **Build local con compose, sin registry.** Confirmado con el usuario; las
  imágenes se construyen con `docker compose build` en el host objetivo.
- **Coexistencia con systemd queda abierta.** No retiramos
  `deploy/robot-platform.service` ni `deploy/install.sh` server-path en esta
  fase; se decide cuando el deploy containerizado tenga una corrida real
  end-to-end.
- **Volúmenes named para datos persistentes.** `pgdata` (ya existe),
  `models`, `frames`, `recordings`, `ts-state` (identidad Tailscale +
  certs). Bind mounts solo para `.env.server` y los templates de nginx.

## Context

- See `spec/mission.md` — los datos del servidor central son la entrega
  visible a empresas; un deploy reproducible reduce el riesgo de downtime.
- See `spec/tech-stack.md` — esta fase modifica explícitamente la línea
  "Container orchestration? None — Docker solo para PostgreSQL en servidor".
  Actualizar tech-stack es parte del entregable.
- See `spec/roadmap.md` Phase 18-22 — el server público con auth, frontend y
  hardening ya está. Esta fase no cambia comportamiento, solo packaging.
- Existing patterns to follow:
  - `docker-compose.server.yml` actual (postgres + named volume).
  - `deploy/nginx.server.conf.template` para la config nginx (adaptar
    `upstream backend` a `back:9090`).
  - `back/config.py` para variables de entorno consumidas.
  - `deploy/install.sh` líneas 323-358 para la lógica de migraciones y
    create-admin que se traduce a `compose run`.
