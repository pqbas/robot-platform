# Plan: Acceso público al server con auth

## Group 1: Auditoría y endurecimiento de endpoints (server mode)

1. Recorrer cada ruta de `back/routes/` que se monta en server mode y verificar que tenga dependencia de auth. Las rutas relevantes son las incluidas en `back/main.py` cuando `config.mode == AppMode.SERVER`:
   - `admin_models.py`, `devices.py`, `empresas.py`, `fundos.py`, `users.py` — ya usan `Depends(admin_dep)`, no tocar.
   - `auth.py` — `/login` debe quedar público; `/me` ya usa `get_current_user`.
   - `sync.py` — `/health` queda público; el resto (`/pull`, `/push`, `/models`, `/device-context`, `/models/{uuid}`, `POST /api/sync/<entity>`) debe llevar `dependencies=_device_dep`. Verificar y agregar `Depends(verify_device_key)` donde falte.
   - `dashboard.py` — agregar `_=Depends(get_current_user)` al endpoint `/api/dashboard/stats`.
   - `setup.py` — el endpoint `/api/config/setup` ya restringe a `AppMode.ROBOT`, no se monta en server. Confirmar.

2. Editar `back/routes/dashboard.py`:
   - Importar `get_current_user` de `back.services.auth`.
   - Agregar `_=Depends(get_current_user)` a la firma de `/stats` siguiendo el patrón de `back/routes/admin_models.py`.

3. Si la auditoría revela otras rutas sin auth, abrir un issue/comentario en este `plan.md` antes de tocarlas; el alcance de esta fase es server-mode únicamente.

---

## Group 2: Eliminar seed `admin/admin` y reemplazarlo por bootstrap interactivo

4. Editar `back/database.py` (líneas 64-76):
   - Reemplazar el bloque que crea `User(username="admin", password_hash=hash_password("admin"), role="admin")` por una verificación que solo siembra el admin si hay variables de entorno `ADMIN_BOOTSTRAP_USERNAME` y `ADMIN_BOOTSTRAP_PASSWORD` definidas.
   - Si no están definidas y la tabla está vacía, log de warning ("server arrancando sin usuarios; correr `make create-admin` para crear el primero") y continuar sin sembrar.
   - Después del seed exitoso, no persistir las variables; el instalador las pasa una sola vez vía systemd `EnvironmentFile` temporal o vía stdin a un script.

5. Crear `back/scripts/create_admin.py`:
   - Script standalone que pide username y password por stdin (`getpass.getpass`).
   - Conecta a la DB usando la misma config que el backend.
   - Llama a `hash_password()` y crea un `User` con `role="admin"`.
   - Falla con mensaje claro si ya existe un usuario con ese username.

6. Agregar target `create-admin` al `Makefile`:
   - `create-admin: ENV_FILE=.env.server uv run python -m back.scripts.create_admin`

7. Editar `deploy/install.sh` (modo `server`):
   - Después del paso de migrations (`alembic upgrade head`), agregar un paso interactivo que invoque `make create-admin` solo si la tabla `users` está vacía.
   - Detectar tabla vacía con `psql` o con un pequeño Python one-liner usando la misma DB config.
   - Si el operador corre el instalador en modo no-interactivo (CI), saltar el paso y mostrar el mismo warning que `init_db`.

---

## Group 3: Tailscale Funnel + nginx en puerto soportado

8. Documentar en `deploy/README.md` (crearlo si no existe) la instalación del agente Tailscale en el server:
   - `curl -fsSL https://tailscale.com/install.sh | sh`
   - `sudo tailscale up` y autenticar con la cuenta del lab.
   - Verificar que el hostname asignado es estable (`tailscale status`).

9. Editar `deploy/nginx.conf.template`:
   - Cambiar `listen 80;` a `listen 443 ssl;` con los certificados que Tailscale Funnel inyecta (`/var/lib/tailscale/certs/<hostname>.crt` y `.key`).
   - Mantener el bloque `upstream backend` apuntando a `127.0.0.1:${BACKEND_PORT}` (sin cambios).
   - Agregar redirect de `:80` a `:443` opcional (Funnel solo enruta 443/8443/10000, así que 80 es solo cosmético).

10. Editar `deploy/install.sh` (modo `server`) para renderar el template con el hostname Tailscale:
    - Detectar hostname con `tailscale status --json | jq -r '.Self.DNSName'` (sin trailing dot).
    - Sustituirlo en `${SERVER_NAME}` del template.
    - Recargar nginx (`sudo systemctl reload nginx`).

11. Activar Funnel:
    - `sudo tailscale funnel 443 on` apuntando al nginx local.
    - Verificar con `tailscale funnel status` que la URL pública responde.

---

## Group 4: Validación end-to-end

12. Desde un navegador fuera de la red del laboratorio (4G del celular), abrir `https://<hostname>.ts.net`. Confirmar que carga la pantalla de login del frontend.

13. Confirmar que sin token, los endpoints sensibles devuelven 401:
    - `curl https://<hostname>.ts.net/api/dashboard/stats` → 401
    - `curl https://<hostname>.ts.net/api/users/` → 401

14. Login con credenciales reales y confirmar que el dashboard carga.

15. Reiniciar el host del server, esperar a que `tailscaled` y nginx levanten, y confirmar que la URL pública sigue siendo la misma y sigue respondiendo.
