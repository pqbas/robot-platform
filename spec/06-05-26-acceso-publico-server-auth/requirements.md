# Requirements: Acceso público al server con auth

## Scope

El server del laboratorio queda accesible desde internet con una URL estable, pero el dashboard y la API solo responden con datos al usuario que presenta credenciales válidas. Todo lo que actualmente sirve el server en `127.0.0.1:9090` queda detrás de un tunnel público + login JWT existente.

Fuera de scope:
- No se toca el robot. Solo se expone el server (Tailscale Funnel corre en la PC del laboratorio).
- No se cambia el modelo de auth (JWT por usuario + API key por device ya implementados en `back/services/auth.py`).
- No se compra dominio propio. Se acepta la URL `https://<machine>.<tailnet>.ts.net` que asigna Tailscale.
- No se agrega rate limiting ni 2FA en esta fase (queda como mejora futura).

## Behavior

- Cualquier persona en internet puede llegar al hostname público del server y ver la pantalla de login.
- Sin token JWT válido, ningún endpoint del server devuelve datos sensibles. La excepción es `POST /api/auth/login` (debe ser pública) y los endpoints que ya validan device API key (`/api/sync/*` para tráfico robot→server).
- Al instalar el server por primera vez, el instalador pide al admin un username + password en lugar de crear `admin/admin`. Si el operador no provee credenciales, el server no arranca con un usuario admin (no hay fallback inseguro).
- El tunnel sobrevive reinicios de la máquina; si el operador reinicia el server o reinicia el host, la URL pública sigue siendo la misma.

## Decisions

- **Tailscale Funnel sobre Cloudflare Tunnel** — no se tiene dominio propio, el costo de comprar uno (~$10/año) no se justifica para un lab sin clientes. Cuando aparezca un cliente real o un sponsor que requiera dominio institucional, migrar a Cloudflare Tunnel es directo (solo cambia la capa de exposición, el backend no se toca).
- **No remover el seed completamente; convertirlo en interactivo** — quitarlo sin reemplazo deja al instalador sin forma de bootstrappear el primer admin. La opción elegida: pedir credenciales al admin durante `deploy/install.sh server` y crearlas con `hash_password()` antes del primer arranque del backend. Si las credenciales no se proveen, el seed automático queda deshabilitado y `init_db` no crea ningún usuario.
- **Auditoría enfocada en rutas server-mode** — las rutas robot-mode (counting, recordings, camellones, locations, config_routes, models_local) no se tocan en esta fase porque el robot no se expone al tunnel; sigue siendo accesible solo en la red local.
- **`/api/dashboard/stats` se protege con `Depends(get_current_user)`** — actualmente está abierta y al exponer el server queda accesible sin login. Es la única ruta server-mode encontrada sin auth dep.
- **El password del admin se ingresa por stdin (no por env var)** — evita que quede en logs/archivos `.env` versionados. El instalador lo pasa al script de seed por stdin.
- **Política de auth en `back/routes/sync.py`** — `/health` queda público (necesario para monitoring externo simple). El resto (`/pull`, `/push`, `/models`, `/device-context`, `/models/{uuid}`, `POST /api/sync/<entity>`) requiere `Depends(verify_device_key)`.

## Context

- See `spec/mission.md` — habilita uso real del server por investigadores fuera del laboratorio.
- See `spec/tech-stack.md` — auth JWT y bcrypt ya forman parte del stack.
- See `spec/roadmap.md` — Phase 18 (esta fase).
- Existing patterns to follow:
  - `back/services/auth.py` — `get_current_user`, `require_role`, `hash_password` ya implementados.
  - `back/routes/admin_models.py` — patrón canónico de ruta protegida (`_=Depends(admin_dep)`).
  - `deploy/install.sh` — instalador bash idempotente, parametrizado por modo (`robot`/`server`).
  - `deploy/nginx.conf.template` — template con variables `${BACKEND_PORT}` / `${SERVER_NAME}` que el instalador renderea.
