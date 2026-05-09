# Requirements: Hardening del server público

## Scope

El server expuesto en Phases 18/19 incorpora cuatro líneas de defensa concretas contra ataques realistas: rate limiting en login, lockout temporal de cuentas tras N fallos, CORS estricto y security headers. Cubre el gap entre "no leakea secrets a scanners pasivos" (lo que ya hay) y "resiste un atacante que sabe qué endpoints existen y los empuja activamente".

Fuera de scope:
- 2FA/MFA — requiere refactor del flow de login + UI nueva, fase aparte.
- JWT refresh tokens — el JWT actual tiene expiración suficientemente corta para un lab; cambiar a access+refresh es buen hábito pero no urgente sin tráfico real.
- Auditoría/log de eventos auth a sistema externo — necesita infra de logging seria; lo que sí dejamos es que los eventos importantes (lockout, rate limit hit) queden en `journalctl`.
- WAF / IDS / fail2ban a nivel sistema — sobreingeniería para un lab. Tailscale Funnel ya filtra el abuso obvio.
- No se toca el modo `ROBOT`. Las defensas son específicas del server público; el robot vive en red local y no tiene el mismo modelo de amenazas.

## Behavior

- Si una IP intenta hacer login más de **5 veces en 5 minutos**, el server responde HTTP 429 con un mensaje "demasiados intentos, esperá X segundos". El contador es por IP, no por username.
- Si un username acumula **5 logins fallidos en 15 minutos**, la cuenta se bloquea por **30 minutos**. Durante el lockout, el server responde 401 con un mensaje "cuenta bloqueada temporalmente, contactar al admin si persiste"; un login exitoso después del lockout limpia el contador.
- En modo `SERVER`, el header `Access-Control-Allow-Origin` solo acepta la URL pública del server (`SERVER_PUBLIC_URL` en `.env.server`). En modo `ROBOT` se mantiene `*` para no romper el setup local del operador.
- Toda respuesta del server (no solo las del frontend) incluye los headers: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.

## Decisions

- **Rate limiting con `slowapi`** — es la integración más usada con FastAPI/Starlette y soporta in-memory + Redis sin cambios de código. El backend ya tiene un solo proceso uvicorn, así que in-memory alcanza; si en el futuro escalamos a múltiples workers, se cambia el backend de slowapi a Redis sin tocar lógica.
- **Rate limit por IP, no por user-agent ni por header customizado** — el atacante controla todos los headers; la IP es lo único confiable. Acepta el caveat de que detrás de un NAT compartido todos comparten el bucket; ese caveat es aceptable para nuestro caso (no esperamos múltiples usuarios legítimos detrás de la misma IP).
- **Lockout en DB, no en memoria** — sobrevive reinicios del server (el atacante no puede esperar a que reiniciemos para resetear el contador). Agrega dos columnas a `users`: `failed_login_attempts INT` y `locked_until DATETIME`. Migración Alembic nueva.
- **5 intentos / 5 min para rate limit, 5 fallos / 15 min para lockout, 30 min de bloqueo** — números conservadores que no molestan al operador real (que rara vez se equivoca 5 veces seguidas) pero frenan brute force serio. Tunearlos requiere observar tráfico real, así que los dejamos como constantes en código y se ajustan en una fase futura si hace falta.
- **CORS por env var `SERVER_PUBLIC_URL`** — no hardcodear porque la URL cambia entre dev (`https://omen.tailfe3013.ts.net`) y producción (la del server del lab). Si la variable no está, fallback a `*` con warning explícito en el log de arranque.
- **Security headers vía middleware ad-hoc** — no agregamos `secure` u otra librería. Cuatro headers fijos en una middleware function de ~10 líneas es más auditable que una dependencia.
- **HSTS solo en server mode** — en modo robot el frontend corre sobre HTTP local; mandar HSTS le diría al navegador "siempre HTTPS" y rompería el flow local.

## Context

- See `spec/06-05-26-acceso-publico-server-auth/` — Phase 18 expuso el server, esta fase lo blinda.
- See `spec/09-05-26-frontend-publico-server/` — Phase 19 dejó el frontend público; la whitelist de SPA routes ya cubre scanners pasivos. Esto agrega defensa activa.
- See `spec/roadmap.md` — Phase 20.
- Existing patterns to follow:
  - `back/routes/auth.py` — el endpoint `/login` actual; hay que agregarle rate limit y lookup de lockout sin reescribirlo.
  - `back/models.py` (línea 98) — modelo `User` al que se le agregan las dos columnas.
  - `back/main.py` (línea 81) — middleware CORS actual; ahí va el security headers también.
  - `back/alembic/versions/` — última migración es `010_tensorrt_engine.py`; nueva migración `011_user_lockout.py`.
