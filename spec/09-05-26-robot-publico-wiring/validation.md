# Validation: Conectar robot al server público

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest` exits 0 sin failures (no se introdujeron regresiones; esta fase NO agrega tests nuevos pero los existentes deben seguir verdes).
- [ ] `uv run ruff check back/` exits 0.

## Manual Checks

### Pre-vuelo

- [ ] `curl -I https://omen.tailfe3013.ts.net/` → 200.
- [ ] `curl https://omen.tailfe3013.ts.net/api/sync/health` → 200.
- [ ] `curl https://omen.tailfe3013.ts.net/api/recordings/` → 401 (auth coverage activa).

### Crear device

- [ ] Login en `https://omen.tailfe3013.ts.net/login` con admin real.
- [ ] `/admin/devices` → crear device → la API key se muestra UNA vez en un modal/banner (no se puede recuperar después).
- [ ] La API key copiada tiene formato esperado (string largo random, no obvio).

### Configurar robot

- [ ] Desde `/setup` en el robot, completar URL + API key → submit OK sin errores 4xx/5xx.
- [ ] `cat .env.robot | grep -E "SYNC_SERVER_URL|SYNC_API_KEY"` muestra los valores nuevos.
- [ ] Logs del backend robot (`make logs`) muestran que `sync_loop` arrancó con la nueva URL y NO loguea 401.

### Sync end-to-end

- [ ] Crear desde el robot: 1 location, 1 session con 2-3 counting events, 1 recording corto (10-15s).
- [ ] En `make logs` del robot ver POST exitosos a `/api/sync/sessions`, `/api/sync/events`, `/api/sync/locations`, `/api/sync/recordings/upload` (o el endpoint que use). Status 200/201, NO 401.
- [ ] Desde el frontend público (red distinta a la del lab, ej: 4G del celular) hacer login y ver:
  - [ ] `/dashboard` → stats reflejan los nuevos eventos.
  - [ ] `/sessions` → la session creada aparece con sus eventos.
  - [ ] `/recordings` → el recording aparece y se puede reproducir/descargar.
  - [ ] `/locations` → la location creada aparece.

### Edge cases

- [ ] Detener temporalmente el server (`sudo systemctl stop robot-platform` en el host del server) → logs del robot muestran timeout/connection refused, sync_loop sigue corriendo (no crashea), reanuda al volver el server.
- [ ] Cambiar API key del device en el server (revoke o regenerar) → logs del robot muestran 401, sync_loop sigue intentando. Restaurar configurando la nueva key desde `/setup`.

### Documentación

- [ ] `deploy/ROBOT_SETUP.md` existe, cubre prerrequisitos / crear device / configurar robot / verificar sync / troubleshooting.
- [ ] Un compañero (o vos mismo en otra ventana) puede leer `ROBOT_SETUP.md` y describir los 3 pasos clave sin abrir el código.
- [ ] `deploy/README.md` linkea a `ROBOT_SETUP.md`.

## Definition of Done

Un robot físico en el lab pushea datos al server público vía Tailscale Funnel y esos datos son visibles desde una red externa después de login. El procedimiento queda escrito en `deploy/ROBOT_SETUP.md` con suficiente detalle para que un operador nuevo lo siga sin acompañamiento.
