# Requirements: Cobertura de auth en server mode

## Scope

En modo SERVER, **toda** ruta del backend exige autenticación (JWT del operador o API key de device) excepto una whitelist explícita y mínima de endpoints públicos. Cierra el gap descubierto durante el hardening de Phase 20: muchas rutas (`/api/locations`, `/api/camellones`, `/api/sessions`, `/api/recordings`, `/api/config/*`, etc.) están montadas en server mode sin `Depends(get_current_user)`, lo que las deja accesibles desde internet sin login.

Fuera de scope:
- Modo ROBOT no se toca. El robot vive en red local; la dependencia global solo aplica en SERVER.
- Roles finos (admin vs operador vs viewer) ya están implementados con `require_role` en routes admin; esta fase no los redefine, solo asegura que ninguna ruta queda sin filtro.
- No reescribimos endpoints, solo agregamos guard global y whitelist.
- Rate limiting / lockout / CORS / headers — ya entregados en Phase 20.

## Behavior

- En modo SERVER, cualquier request a una ruta no whitelist sin JWT válido (operador) o API key válida (device) devuelve 401 inmediato.
- La whitelist de rutas públicas en SERVER es:
  - `POST /api/auth/login` — el flujo de login.
  - `GET /api/sync/health` — heartbeat usado por monitoring.
  - `/` y rutas SPA whitelist + `/assets/*` — el frontend estático (Phase 19).
  - Endpoints que ya validan API key de device (`POST /api/sync/*`) siguen funcionando con su mecanismo existente.
- En modo ROBOT, comportamiento sin cambios — el robot está en red local y mantiene sus rutas como hoy.
- El frontend público sigue funcionando sin cambios visibles para el operador (login → dashboard → datos), porque el guard solo bloquea requests sin token.

## Decisions

- **Auth global vía dependency con whitelist** — más robusto que ir ruta por ruta agregando `Depends(get_current_user)`: si alguien agrega una ruta nueva mañana queda protegida automáticamente. La whitelist es explícita y corta (3-4 paths), fácil de auditar.
- **El guard se aplica solo en server mode** — modo robot no lo necesita y agregarlo rompería el flow del operador local. El guard se monta condicionalmente en `back/main.py` según `app_config.mode`.
- **El guard acepta tanto JWT como API key de device** — sync routes ya usan API key con `_device_dep`. El guard global no las re-valida; las saltea si la ruta empieza con `/api/sync/` (ya tiene su propio dep) o si trae header `X-Device-API-Key` válido.
- **Whitelist por path exacto + prefijos `/api/sync/`, `/assets/`** — los SPA paths ya están manejados por el fallback de Phase 19, que no pasa por `/api/`; el guard solo se ejecuta sobre paths `/api/*` que no estén en la whitelist.
- **Reauditar manual antes de mergear** — el guard cierra el caso general, pero queremos confirmar caso por caso que las rutas legítimamente públicas funcionan (login, health) y que las rutas privadas devuelven 401 sin token.
- **No tocar `/api/config/setup-status`** — en server mode, simplemente cae bajo el guard global y devuelve 401. No vale la pena hacer un caso especial.

## Context

- See `spec/06-05-26-acceso-publico-server-auth/` — Phase 18 montó auth en routes específicas (dashboard).
- See `spec/09-05-26-server-hardening/` — Phase 20 entregó las defensas activas; esta fase cierra la cobertura.
- See `spec/roadmap.md` — Phase 22.
- Existing patterns to follow:
  - `back/services/auth.py` — `get_current_user` y `require_role` ya implementados.
  - `back/routes/sync.py` — patrón de dependencia API key (`_device_dep`).
  - `back/routes/dashboard.py` (línea 22) — ejemplo de ruta correctamente protegida con `Depends(get_current_user)`.
  - `back/main.py` (línea 110-141) — donde se montan los routers; ahí va la dependency global condicional.
