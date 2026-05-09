# Validation: Hardening del server público

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest` exits 0 with no failures
- [ ] `uv run ruff check back/` exits 0 sin errores nuevos

### Specific test coverage required

- [ ] 5 login fallidos al mismo username → la cuenta queda con `locked_until` futuro y el 6º intento (incluso con password correcto) devuelve 401 con mensaje "Cuenta bloqueada"
- [ ] Login exitoso resetea `failed_login_attempts` a 0 y `locked_until` a NULL
- [ ] 6 login attempts en <5 min desde la misma IP → la 6ª devuelve HTTP 429 (rate limit hit)
- [ ] La respuesta de cualquier endpoint incluye los headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] La respuesta en server mode incluye `Strict-Transport-Security: max-age=31536000; includeSubDomains` (en robot mode, NO debe incluirlo)

## Manual Checks

- [ ] Levantar el server en modo SERVER sin `SERVER_PUBLIC_URL` definido → log warning "CORS abierto en *. Configurarlo para producción."
- [ ] Definir `SERVER_PUBLIC_URL=https://omen.tailfe3013.ts.net` en `.env.server` y reiniciar → `curl -I -H "Origin: https://malicious.com" https://<host>.ts.net/api/sync/health` no devuelve `Access-Control-Allow-Origin: https://malicious.com`; un `curl -I -H "Origin: https://omen.tailfe3013.ts.net" ...` sí lo devuelve
- [ ] Brute force manual: correr `for i in {1..7}; do curl -X POST https://<host>.ts.net/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"wrong"}'; done` → primeros 5 devuelven 401, sexto devuelve 429
- [ ] Después del lockout, esperar 30 min (o resetear DB) y confirmar que el login con credenciales válidas vuelve a funcionar
- [ ] `curl -I https://<host>.ts.net/` devuelve los 4 security headers
- [ ] El frontend (cargado desde `https://<host>.ts.net`) sigue funcionando — el operador puede hacer login y el dashboard carga datos sin errores de CORS en la consola del navegador
- [ ] Modo `ROBOT` no se rompe: `make run-robot` arranca, el frontend local en `localhost:5173` puede llamar a `localhost:8080` sin problemas de CORS

## Definition of Done

Todos los checkboxes arriba marcados, branch rebasado contra `master`, sin código de debug ni TODOs nuevos, y un brute force manual de 6 intentos confirma 401 → 401 → ... → 429 con la cuenta bloqueada después.
