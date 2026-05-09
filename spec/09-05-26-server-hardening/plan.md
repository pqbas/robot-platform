# Plan: Hardening del server público

## Group 1: Rate limiting con slowapi

1. Agregar `slowapi` a las dependencias: `uv add slowapi`.

2. Editar `back/main.py`:
   - Importar `Limiter` y `_rate_limit_exceeded_handler` de `slowapi`, y `RateLimitExceeded` de `slowapi.errors`.
   - Importar `get_remote_address` de `slowapi.util`.
   - Crear `limiter = Limiter(key_func=get_remote_address)`.
   - Asignar `app.state.limiter = limiter`.
   - Registrar el exception handler: `app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)`.

3. Editar `back/routes/auth.py`:
   - Importar el `limiter` de `back.main` (cuidado con import circular — si hace falta, mover el `limiter` a `back/services/rate_limit.py` o similar).
   - Decorar el handler `login` con `@limiter.limit("5/5minutes")`.
   - Agregar `request: Request` como primer parámetro de la función `login` (slowapi lo necesita).

---

## Group 2: Account lockout en DB

4. Editar `back/models.py`:
   - En la clase `User`, agregar dos columnas:
     - `failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)`
     - `locked_until: Mapped[str | None] = mapped_column(Text, nullable=True)` (formato ISO string para consistencia con `created_at`).

5. Crear migración `back/alembic/versions/011_user_lockout.py`:
   - `op.add_column('users', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))`
   - `op.add_column('users', sa.Column('locked_until', sa.Text(), nullable=True))`
   - Downgrade: drop ambas columnas.

6. Crear `back/services/lockout.py` con dos helpers puros y testeables:
   - `is_locked(user: User) -> bool`: True si `user.locked_until` es futuro.
   - `register_failed_attempt(user: User) -> None`: incrementa `failed_login_attempts`. Si llegó a 5 y la última fue hace ≤15 min, setea `locked_until = now + 30min`. Si la primera de la racha fue hace >15 min, resetea contador.
   - `register_successful_login(user: User) -> None`: setea `failed_login_attempts = 0` y `locked_until = None`.
   - Las constantes (`MAX_FAILED_ATTEMPTS = 5`, `WINDOW_MINUTES = 15`, `LOCKOUT_MINUTES = 30`) viven al inicio del módulo.

7. Editar `back/routes/auth.py` función `login`:
   - Después del `result = await db.execute(...)`, antes del `verify_password`:
     - Si `user` existe y `is_locked(user)`: `raise HTTPException(401, detail="Cuenta bloqueada temporalmente. Reintentar más tarde o contactar al admin.")`.
   - Si `verify_password` falla con un user que existe: llamar `register_failed_attempt(user)` y `await db.commit()` antes del raise 401.
   - Si `verify_password` pasa: llamar `register_successful_login(user)` y `await db.commit()` antes de devolver el token.

---

## Group 3: CORS estricto y security headers

8. Editar `back/config.py`:
   - Agregar `public_url: str = os.getenv("SERVER_PUBLIC_URL", "")` en la sección que ya tiene `server_url`.

9. Editar `back/main.py`:
   - Reemplazar `allow_origins=["*"]` por una variable que se computa al inicio:
     - Si `app_config.mode == AppMode.SERVER` y `app_config.public_url`: `allow_origins=[app_config.public_url]`.
     - Si server mode pero falta `public_url`: log warning ("SERVER_PUBLIC_URL vacío; CORS abierto en *. Configurarlo para producción.") y mantener `["*"]`.
     - Si robot mode: mantener `["*"]`.

10. Crear `back/middleware/security_headers.py`:
    - Middleware ASGI sencillo (`async def security_headers_middleware(request, call_next)`) que añade los 4 headers a la respuesta:
      - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (solo en server mode)
      - `X-Content-Type-Options: nosniff` (siempre)
      - `X-Frame-Options: DENY` (siempre)
      - `Referrer-Policy: strict-origin-when-cross-origin` (siempre)

11. Editar `back/main.py`:
    - Registrar el middleware con `app.middleware("http")(security_headers_middleware)` después del CORS middleware.

---

## Group 4: Tests

12. Editar/crear `tests/test_auth_endpoints.py`:
    - Test: 5 login fallidos consecutivos al mismo username → al 6º intento (sin importar password) el server responde 401 con mensaje de cuenta bloqueada.
    - Test: tras login exitoso, `failed_login_attempts` queda en 0 y `locked_until` en None.
    - Test: 6 login attempts en menos de 5 minutos desde la misma IP → la 6ª devuelve 429 (rate limit).
    - Test: respuesta de `/api/auth/login` incluye los 4 security headers.

13. Correr `uv run pytest` y `uv run ruff check back/`.

---

## Group 5: Documentación

14. Editar `README.md`:
    - En la sección "Exponer el server a internet (Tailscale Funnel)", agregar instrucción de exportar `SERVER_PUBLIC_URL=https://<host>.ts.net` en `.env.server` antes de levantar el server.

15. Editar `deploy/README.md` con la misma instrucción.
