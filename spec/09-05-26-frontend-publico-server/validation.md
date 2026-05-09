# Validation: Frontend público vía server mode

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest` exits 0 with no failures
- [ ] `uv run ruff check back/` exits 0 sin errores nuevos

### Specific test coverage required

- [ ] `GET /` devuelve 200 con `Content-Type: text/html` y el body contiene el marcador del root del SPA (ej. `<div id="root">`)
- [ ] `GET /dashboard` devuelve 200 con el mismo HTML que `GET /` (SPA fallback)
- [ ] `GET /api/sync/health` sigue devolviendo 200 con JSON (regresión)
- [ ] `GET /assets/<archivo-inexistente>.js` devuelve 404 (StaticFiles no hace SPA fallback para assets)

## Manual Checks

- [ ] Levantar el server con `front/dist/` ausente (renombrar la carpeta temporalmente) → log warning indicando que falta el build, la API responde, `GET /` devuelve 503 con mensaje claro.
- [ ] `make build-front` regenera `front/dist/index.html`. Después `make run-server` arranca sin warning.
- [ ] Con el funnel activo (`sudo tailscale funnel --bg 9090`), abrir `https://<host>.ts.net/` desde un navegador en red 4G → carga la pantalla de login del frontend (no JSON, no 404).
- [ ] Hacer login con credenciales válidas desde el navegador externo → redirige al dashboard, los datos cargan vía la API en la misma URL.
- [ ] Recargar la página estando en `/dashboard` (F5) → no devuelve 404, recarga el SPA correctamente.
- [ ] Verificar que el modo `ROBOT` no se rompió: `make run-robot` arranca sin error y el frontend del operador (`make run-front` apuntando a `localhost:8080`) sigue funcionando como antes.

## Definition of Done

Todos los checkboxes arriba marcados, branch rebasado contra `master`, sin código de debug ni TODOs nuevos, y la URL pública del server confirmada cargando la app completa (login + dashboard) desde fuera del laboratorio.
