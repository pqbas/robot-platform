# Validation: TLS local en nginx del robot — secure context sin flag por device

Implementación está completa y lista para mergear cuando todo lo siguiente pase.

## Automated Tests

- [ ] `sudo nginx -t` después de `make deploy-robot` reporta `syntax is ok` y `test is successful`.
- [ ] `cd front && npm run build` termina sin errores (sin regresiones en el build del frontend).
- [ ] `cd front && tsc --noEmit` exit 0.

### Specific checks required

- [ ] `openssl x509 -in /etc/nginx/certs/robot.crt -noout -text | grep "IP Address"` muestra `IP Address:192.168.0.10`.
- [ ] `openssl x509 -in /etc/nginx/certs/robot.crt -noout -dates` muestra una validez de al menos 1 año en el futuro.
- [ ] `ls -la /etc/nginx/certs/robot.key` muestra permisos `-rw-------` y owner `root:root`.
- [ ] `curl -fsS http://192.168.0.10/ca.crt -o /tmp/ca.pem && openssl x509 -in /tmp/ca.pem -noout -subject` devuelve un subject que empieza con `CN = mkcert ...`.
- [ ] `curl -kfsSI https://192.168.0.10/` devuelve `200 OK` y headers de nginx.
- [ ] `curl -fsSI http://192.168.0.10/vision` devuelve `301 Moved Permanently` con `Location: https://192.168.0.10/vision`.

## Manual Checks

**Setup (una sola vez, desde un device de prueba sin CA instalada):**

- [ ] Abrir `http://192.168.0.10/ca.crt` en un Chrome (desktop o Android) que NO tenga la CA → el browser ofrece descargar el archivo `robot-ca.crt`.
- [ ] Instalar la CA siguiendo el procedimiento documentado en `deploy/ROBOT_SETUP.md`.
- [ ] Cerrar y reabrir el browser (algunos OS cachean los stores).

**Happy path con CA instalada:**

- [ ] Visitar `https://192.168.0.10/vision` → carga sin warnings, candado verde en la barra de URL.
- [ ] DevTools → Console: no aparece `[wc] VideoDecoder API no disponible` ni `SecurityError`.
- [ ] El stream WebCodecs arranca sin tocar `chrome://flags`.
- [ ] DevTools → Network: las conexiones WebSocket se ven como `wss://` (status 101).
- [ ] Quitar la flag `chrome://flags/#unsafely-treat-insecure-origin-as-secure` que se había seteado en Phase 28 → el feature sigue funcionando.

**Compatibilidad y degradación:**

- [ ] Visitar `http://192.168.0.10/vision` (HTTP plano) → redirige automáticamente a `https://...` y carga normal.
- [ ] Visitar `https://192.168.0.10/` desde un device SIN la CA → browser muestra `NET::ERR_CERT_AUTHORITY_INVALID`. En desktop Chrome el operador puede "Advanced → Proceed" y la app funciona. En Android Chrome (sin opción de bypass), la app no carga — esto es esperado y está documentado.
- [ ] Multi-device: dos clientes con la CA instalada conectados simultáneamente a `/vision` → ambos reciben video y detecciones sin errores nuevos (regresión-test de Phase 28).

**Deploy idempotente:**

- [ ] Correr `make update` con los certs ya existentes → NO regenera `robot.crt`/`robot.key` (las fechas y el fingerprint del cert quedan iguales antes y después).
- [ ] Correr `make deploy-robot` por segunda vez → no falla, no regenera certs, nginx queda recargado sin warnings.

**Backend integración:**

- [ ] Login al panel admin (POST `/api/auth/login`) funciona sobre HTTPS → cookies de sesión se setean con flag `Secure`.
- [ ] `make logs` durante una sesión de visión muestra los frames moviéndose sin errores nuevos relacionados a TLS / proxy.
- [ ] `sync_loop` al server público (Tailscale) sigue funcionando — los outbound del robot no se ven afectados por el cambio en nginx.

## Post-deploy Checks

- [ ] Después del primer `make deploy-robot` con TLS, confirmar con el operador desde su celu real (no solo desde la laptop del dev) que `https://192.168.0.10/vision` anda sin warnings y sin flag.
- [ ] Verificar que `journalctl -u nginx --since "10 min ago"` no tiene errores SSL nuevos (handshake fails, cipher mismatch).

## Rollback Criteria

Si después del deploy un device crítico (celu del operador en el fundo) no puede acceder ni siquiera por HTTP-redirect, revertir el commit del template nginx y volver a `make deploy-robot` para que solo escuche en 80. Los certs en `data/robot/certs/` quedan para el próximo intento.

## Definition of Done

Todas las cajas arriba marcadas, el operador puede usar `https://192.168.0.10/vision` desde celu y laptop sin tocar `chrome://flags`, y el caveat de Phase 28 desaparece del roadmap (se marca Phase 29 como `(Complete)`).
