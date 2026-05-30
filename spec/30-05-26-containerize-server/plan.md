# Plan: Containerize server

## Group 1: Backend image

1. Crear `back/Dockerfile` con base `python:3.13-slim`:
   - `WORKDIR /app`
   - Instalar `uv` vía pip (versión pineada).
   - Copiar `pyproject.toml` y `uv.lock` raíz, correr `uv sync --frozen --no-dev`.
   - Copiar `back/` al image.
   - `EXPOSE 9090`.
   - `CMD ["uv", "run", "uvicorn", "back.main:app", "--host", "0.0.0.0", "--port", "9090"]`.
   - Sin `--reload`.

2. Crear `back/.dockerignore` que excluya: `data/`, `.venv/`, `__pycache__/`,
   `.pytest_cache/`, `.ruff_cache/`, `*.db`, `.env*`, `tests/`.

3. Verificar que `back/main.py` lee `ENV_FILE` correctamente cuando
   `.env.server` está bind-mounteado en `/app/.env.server`. No requiere
   cambio si `ENV_FILE=.env.server` se pasa como env del container.

---

## Group 2: Frontend build image

4. Crear `front/Dockerfile` multi-stage:
   - Stage `build`: base `node:20-alpine`, `WORKDIR /app`, copiar
     `front/package.json` + `front/package-lock.json`, `npm ci`, copiar
     `front/`, `npm run build`.
   - Stage final: base `nginx:1.27-alpine`, copiar `--from=build /app/dist`
     a `/usr/share/nginx/html`.
   - Nota: este stage final se reemplaza por el servicio `nginx` del compose;
     el `front` image existe solo para producir `dist`. Documentar esta
     intención en comentario del Dockerfile.

5. Crear `front/.dockerignore`: excluir `node_modules/`, `dist/`, `.env*`.

---

## Group 3: Nginx servicio

6. Crear `deploy/nginx.compose.conf.template` adaptado de
   `deploy/nginx.server.conf.template`:
   - `upstream backend { server ${BACKEND_HOST}:${BACKEND_PORT}; }`.
   - `root /usr/share/nginx/html;` (volumen del front dist).
   - `ssl_certificate /var/lib/tailscale/certs/${SERVER_NAME}.crt;`.
   - `ssl_certificate_key /var/lib/tailscale/certs/${SERVER_NAME}.key;`.
   - Bloques `/offer`, `/toggle_processing`, `/api/`, `/ws/` con los
     mismos headers que el template original.

7. Usar el entrypoint nativo de `nginx:1.27-alpine` que ya soporta
   `envsubst` sobre `/etc/nginx/templates/*.conf.template` con sufijo
   `.conf.template`. Variables: `${SERVER_NAME}`, `${BACKEND_HOST}=back`,
   `${BACKEND_PORT}=9090`.

## Group 3b: Tailscale sidecar

8. Agregar servicio `tailscale` al compose con imagen oficial
   `tailscale/tailscale:stable`:
   - `hostname: ${TS_HOSTNAME}`.
   - `environment`:
     - `TS_AUTHKEY` (de `.env.server`).
     - `TS_HOSTNAME` (mismo valor que `hostname`).
     - `TS_STATE_DIR=/var/lib/tailscale`.
     - `TS_USERSPACE=true` (no requiere `/dev/net/tun` en host).
     - `TS_EXTRA_ARGS=--ssh=false`.
     - `TS_SERVE_CONFIG=/config/serve.json` (apuntando a un bind mount
       generado en paso 9).
   - `volumes`:
     - `ts-state:/var/lib/tailscale` (identidad + certs).
     - `./deploy/tailscale.serve.json:/config/serve.json:ro`.
   - `cap_add: [NET_ADMIN]`.
   - `restart: unless-stopped`.

9. Crear `deploy/tailscale.serve.json` con la config de Funnel que apunta
   al `nginx` interno:
   ```json
   {
     "TCP": {"443": {"HTTPS": true}},
     "Web": {
       "${TS_HOSTNAME}:443": {
         "Handlers": {"/": {"Proxy": "http://nginx:80"}}
       }
     },
     "AllowFunnel": {"${TS_HOSTNAME}:443": true}
   }
   ```
   Nota: el `nginx` container escucha solo en `:80` interno; Funnel
   delega TLS a `tailscaled`. Esto significa que `nginx` ya no necesita
   `ssl_*` directivas (ver paso 6, actualizar para quitar la sección
   `listen 443 ssl` y dejar solo `listen 80`).

10. Actualizar el template de nginx del paso 6: eliminar el bloque
    `server { listen 443 ssl; ... }`, mover el contenido (`root`,
    locations) al bloque `listen 80;` y quitar la redirección
    HTTP→HTTPS. Razón: TLS lo termina `tailscaled` antes de pasar el
    request al nginx interno.

---

## Group 4: docker-compose.server.yml

9. Reescribir `docker-compose.server.yml`:
   - Mantener servicio `postgres` (image, env, ports, volumen `pgdata`).
   - Agregar `healthcheck` a `postgres`: `pg_isready -U platform -d
     robot_platform`.

10. Agregar servicio `back`:
    - `build: { context: ., dockerfile: back/Dockerfile }`.
    - `env_file: .env.server`.
    - `environment: { ENV_FILE: .env.server }`.
    - `depends_on: { postgres: { condition: service_healthy } }`.
    - `volumes`:
      - `models:/app/data/server/models`
      - `frames:/app/data/server/frames`
      - `recordings:/app/data/server/recordings`
    - `restart: unless-stopped`.
    - Sin `ports:` mapeados (acceso solo vía `nginx`).

11. Agregar servicio `front` como builder one-shot:
    - `build: { context: ./front, dockerfile: Dockerfile, target: build }`.
    - `command: ["sh", "-c", "cp -r /app/dist/. /usr/share/nginx/html/"]`.
    - `volumes: [front-dist:/usr/share/nginx/html]`.
    - `restart: "no"`.

12. Agregar servicio `nginx`:
    - `image: nginx:1.27-alpine`.
    - `ports: ["80:80"]` para acceso HTTP plano en LAN del host
      (debugging y uso local). Funnel sigue siendo el path público con
      TLS via el sidecar.
    - `depends_on: [back, front]`.
    - `environment: { SERVER_NAME: "${TS_HOSTNAME}", BACKEND_HOST: back, BACKEND_PORT: 9090 }`.
    - `volumes`:
      - `./deploy/nginx.compose.conf.template:/etc/nginx/templates/default.conf.template:ro`
      - `front-dist:/usr/share/nginx/html:ro`
    - `restart: unless-stopped`.

13. Definir `volumes`: `pgdata`, `models`, `frames`, `recordings`,
    `front-dist`, `ts-state`. `front-dist` es anónimo entre `front` y
    `nginx`; `ts-state` persiste identidad Tailscale.

14. Definir `networks`: usar la red default de compose (ya implícita).

---

## Group 5: Migraciones y bootstrap

15. Documentar en `deploy/README.md` el flujo containerizado:
    - Generar un auth key reusable en
      https://login.tailscale.com/admin/settings/keys.
    - `cp .env.example .env.server` y completar `TS_AUTHKEY`,
      `TS_HOSTNAME`, secrets de DB/JWT.
    - `docker compose -f docker-compose.server.yml build`.
    - `docker compose -f docker-compose.server.yml up -d postgres tailscale`.
    - `docker compose ... run --rm back alembic -c back/alembic.ini upgrade
      head`.
    - `docker compose ... run --rm back python -m back.scripts.create_admin`
      (interactivo, si users vacío).
    - `docker compose ... up -d`.
    - Nota: si el host ya tiene Tailscale instalado y otro nodo con el
      mismo `TS_HOSTNAME`, hay que cambiar el nombre o desautenticar el
      nodo anterior desde admin. Coexistencia con systemd robot-platform
      sigue siendo posible (este compose no toca puertos del host).

16. Actualizar `Makefile` con targets opcionales:
    - `compose-up`: `docker compose -f docker-compose.server.yml up -d`.
    - `compose-build`: `docker compose -f docker-compose.server.yml build`.
    - `compose-migrate`: `docker compose ... run --rm back alembic ...
      upgrade head`.
    - `compose-create-admin`: `docker compose ... run --rm back python -m
      back.scripts.create_admin`.
    - `compose-logs`: `docker compose ... logs -f`.
    - `compose-down`: `docker compose ... down`.

17. Actualizar `spec/tech-stack.md`:
    - Línea "Container orchestration? None — Docker solo para PostgreSQL en
      servidor" → "Docker Compose para el server (back + front + nginx +
      postgres + tailscale sidecar); robot sigue en bare metal con
      systemd".

---

## Group 6: Verificación

18. Verificar que `docker compose -f docker-compose.server.yml config` no
    arroja errores.

19. Verificar que `docker compose ... build` completa los tres images
    (`back`, `front`, no rebuild de `postgres`/`nginx`/`tailscale`).

20. Verificar `docker compose ... up -d` con `.env.server` mínimo, y que
    `docker compose ... exec tailscale tailscale status` muestra el nodo
    autenticado y Funnel activo en `:443`.

21. Verificar que `curl https://${TS_HOSTNAME}/api/sync/health` desde
    internet devuelve 200.

22. Verificar que `curl https://${TS_HOSTNAME}/` sirve `index.html` del
    frontend.

23. Verificar que `docker compose ... down -v` limpia volúmenes y restart
    desde cero rehidrata Postgres con migraciones (requiere generar nuevo
    `TS_AUTHKEY` o reusar uno reusable).
