# Validation: Cobertura de auth en server mode

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest` exits 0 sin failures
- [ ] `uv run ruff check back/` exits 0 sin errores nuevos

### Specific test coverage required

- [ ] Sin Authorization header en server mode, las siguientes rutas devuelven 401:
  - `/api/locations`, `/api/camellones`, `/api/sessions`, `/api/recordings/`, `/api/config/setup-status`, `/api/config/counting`, `/api/dashboard/stats`, `/api/users/`, `/api/empresas/`, `/api/devices/`
- [ ] `/api/auth/login` y `/api/sync/health` devuelven 200 (o el código apropiado del endpoint) SIN Authorization header en server mode
- [ ] Con JWT válido en `Authorization: Bearer <token>`, las rutas privadas devuelven 200/4xx según corresponda — pero NO 401
- [ ] En modo ROBOT, `/api/locations` y compañía siguen siendo accesibles sin auth (regresión)
- [ ] Sync con device API key (`POST /api/sync/sessions` con `X-API-Key`) sigue funcionando — no regresión del flow de Phase 18

## Manual Checks

- [ ] Levantar server (`make run-server`) y desde curl externo:
  - `curl https://omen.tailfe3013.ts.net/api/config/setup-status` → 401
  - `curl https://omen.tailfe3013.ts.net/api/recordings/` → 401
  - `curl https://omen.tailfe3013.ts.net/api/sessions` → 401
  - `curl https://omen.tailfe3013.ts.net/api/sync/health` → 200
- [ ] Login en el frontend público (`https://<host>.ts.net/`) sigue funcionando — el dashboard carga sus datos sin errores
- [ ] Modo robot: `make run-robot` arranca, frontend local en `localhost:5173` opera normalmente sin errores 401
- [ ] Logs del server NO muestran requests 200 a `/api/config/setup-status` desde IPs externas (los bots reciben 401)
- [ ] Sync robot → server (si hay un robot configurado) sigue empujando datos — no se rompió el flow con device API key

## Definition of Done

Todos los checkboxes arriba marcados, branch rebasado contra `master`, sin código de debug ni TODOs nuevos. Validación crítica: un curl externo a cualquier ruta `/api/*` no whitelist devuelve 401, y el frontend público autenticado sigue funcionando end-to-end.
