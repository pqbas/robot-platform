# Validation: Acceso público al server con auth

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest` exits 0 with no failures
- [ ] `uv run ruff check back/` exits 0 con sin errores nuevos

### Specific test coverage required

- [ ] `GET /api/dashboard/stats` sin Authorization header devuelve 401
- [ ] `GET /api/dashboard/stats` con JWT válido devuelve 200 y los stats
- [ ] `GET /api/sync/health` sin auth devuelve 200 (queda público)
- [ ] `GET /api/sync/pull` sin device key devuelve 401

> Nota: el repo no tiene infra de tests de DB (no existe `back/tests/` ni `conftest.py`). Los tests de `init_db()` y `create_admin.py` se cubren como manual checks abajo en lugar de inventar el harness en esta fase.

## Manual Checks

- [ ] Recorrer cada router montado en `back/main.py` cuando `config.mode == AppMode.SERVER` y confirmar en código que cada handler tiene `Depends(admin_dep)`, `Depends(get_current_user)`, `Depends(verify_device_key)`, o es explícitamente público (login, health). Anotar el resultado en un comentario del PR.
- [ ] Levantar el server limpio (DB vacía) sin variables de bootstrap → log dice "server arrancando sin usuarios"; intentar login con `admin/admin` falla con 401.
- [ ] Confirmar en código que `init_db()` con `ADMIN_BOOTSTRAP_USERNAME` + `ADMIN_BOOTSTRAP_PASSWORD` definidos crea un user `role="admin"` con password hasheado (revisar manualmente; no hay test infra).
- [ ] Correr `make create-admin`, ingresar username y password, intentar login con esas credenciales → 200 + token.
- [ ] Volver a correr `make create-admin` con el mismo username → falla con exit != 0 y mensaje claro.
- [ ] `sudo tailscale funnel status` muestra el server escuchando en `:443`.
- [ ] Desde un navegador en red 4G (fuera del laboratorio), abrir `https://<hostname>.ts.net` → carga la pantalla de login del frontend.
- [ ] Desde el mismo navegador externo, hacer login y confirmar que el dashboard carga datos reales.
- [ ] `curl -i https://<hostname>.ts.net/api/dashboard/stats` (sin Authorization) → `HTTP/2 401`.
- [ ] Reiniciar el host del server (`sudo reboot`), esperar 2 minutos, y confirmar que `https://<hostname>.ts.net` sigue respondiendo en la misma URL.

## Post-deploy Checks

- [ ] `journalctl -u robot-platform -u nginx -u tailscaled` no muestra errores en los primeros 5 minutos post-deploy.
- [ ] El hostname público está documentado en `deploy/README.md` para que el equipo sepa cómo acceder.

## Rollback Criteria

Si el funnel queda accesible sin auth (cualquier endpoint server-mode responde 200 sin token desde fuera), apagar el funnel inmediatamente con `sudo tailscale funnel 443 off` y abrir issue.

## Definition of Done

Todos los checkboxes arriba marcados, branch rebasado contra `master`, sin código de debug ni TODOs nuevos, y la URL pública confirmada accesible desde fuera del laboratorio con login funcional.
