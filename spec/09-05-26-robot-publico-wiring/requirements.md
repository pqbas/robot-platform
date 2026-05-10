# Requirements: Conectar robot al server público

## Scope

Validar end-to-end que un robot físico (Jetson) configurado contra el server público (`https://omen.tailfe3013.ts.net`) sincroniza datos correctamente, y dejar documentado el procedimiento para que un operador nuevo pueda configurar un robot de cero.

Toda la infraestructura ya existe (Phase 18: auth, Phase 19: frontend público, Phase 22: auth coverage). Esta fase NO construye sync, NO redefine endpoints, NO toca routes — solo:

1. Verifica que el flow funciona contra el server real.
2. Detecta y arregla bugs de wiring (env vars mal nombradas, URL hardcodeadas, etc) que aparezcan en la prueba real.
3. Genera `deploy/ROBOT_SETUP.md` con el paso a paso operativo.

Fuera de scope:
- Refactor de `sync_*.py` o `routes/sync.py` — si hay bugs aparecen en validación; se arreglan acotados.
- Mejoras a `/admin/devices` (regenerar API key, copy-to-clipboard) — quedan para una fase futura si la prueba lo amerita.
- Tests automatizados nuevos — Phase 22 ya cubre el contrato del server; el robot lo prueba vivo.

## Behavior

Flow esperado para un operador configurando un robot nuevo:

1. Admin (en server público) → `/admin/devices` → crea device con label descriptivo → ve la API key UNA sola vez → la copia a un lugar seguro.
2. Operador (en el robot, frontend en `localhost:5173`) → `/setup` → ingresa `https://omen.tailfe3013.ts.net` y la API key → guarda.
3. Backend del robot persiste en `.env.robot` (`SYNC_SERVER_URL`, `SYNC_API_KEY`) y reinicia `sync_loop`.
4. `sync_loop` empieza a pushear sessions/events/recordings/locations al server público vía HTTPS con `Authorization: Bearer <api_key>`.
5. Admin (en cualquier red) → entra al frontend público con su login → ve los datos del robot en `/dashboard`, `/sessions`, `/recordings`.

Edge cases relevantes:
- Si la API key es inválida → server devuelve 401, robot loguea el error, sync_loop sigue intentando con backoff.
- Si el server está down → robot loguea timeout, retry con backoff.
- Si el robot pierde internet → sync queda en cola local, reanuda al volver.

## Decisions

- **No auditamos código de sync antes de probar** — la infra de Phase 18 ya pasó tests; si algo se rompe contra el server real, lo vemos en validación y arreglamos puntual. Auditar especulativamente alarga la fase sin ganancia.
- **Procedimiento se documenta en `deploy/ROBOT_SETUP.md`** — junto al resto de docs operativas (deploy, install). No va en `back/routes/README.md` porque no es contrato de API; es guía de operador.
- **Tailscale Funnel como dependencia hard** — el robot necesita resolver `omen.tailfe3013.ts.net` y la URL debe estar activa. La doc menciona explícitamente cómo verificar (`tailscale funnel status`).
- **No agregamos retry exponencial fancy** — si `sync_loop` actual no lo tiene, no es scope de esta fase. Retry simple con intervalo fijo es suficiente para validar.
- **Bug fixes encontrados durante validación van en commits separados** — para que el "wiring puro" quede limpio y los fixes sean trazables.

## Context

- See `spec/06-05-26-acceso-publico-server-auth/` — Phase 18 entregó auth + sync routes.
- See `spec/09-05-26-frontend-publico-server/` — Phase 19 entregó frontend público.
- See `spec/09-05-26-auth-coverage/` — Phase 22 cerró cobertura de auth en `/api/*`.
- See `spec/roadmap.md` — Phase 21.
- Existing patterns to follow:
  - `back/services/sync_push.py` — header `Authorization: Bearer <api_key>` ya correcto.
  - `back/routes/setup.py:40-90` — endpoint que persiste config y reinicia loop.
  - `back/routes/devices.py` — CRUD admin (asumimos creación + reveal API key una vez ya implementados).
  - `deploy/README.md` — formato y tono de las guías operativas.
