# Plan: Cobertura de auth en server mode

## Group 1: Auditoría e inventario

1. Crear `spec/09-05-26-auth-coverage/audit.md` con tabla de todas las rutas montadas en server mode y su estado de auth actual:
   - Recorrer `back/routes/*.py` y listar cada `@router.<method>`.
   - Marcar cada una como: `JWT`, `API key`, `role admin`, o `NONE`.
   - Esta tabla es solo el insumo para validar el guard; no se commitea al final si no aporta — eliminarla en el último commit del feature si quedó redundante con el guard.

---

## Group 2: Guard global con whitelist

2. Crear `back/services/auth_guard.py`:
   - Función `async def server_auth_guard(request: Request, db: AsyncSession = Depends(get_db)) -> None`.
   - Whitelist exacta de paths: `{"/api/auth/login", "/api/sync/health"}`.
   - Whitelist por prefijo: `/api/sync/` (las rutas con `_device_dep` ya validan su propia API key).
   - Para todo lo demás: extrae el header `Authorization`, valida JWT con la lógica ya en `back/services/auth.py` (mover/exponer `decode_access_token` si hace falta).
   - Si JWT falta o es inválido: `raise HTTPException(401, detail="Authentication required")`.
   - No retorna el `User` — el guard solo bloquea; las rutas que necesitan el user siguen usando `Depends(get_current_user)` por su cuenta.
   - Caveat: el guard NO toca paths que no empiezan con `/api/` (frontend estático ya manejado por SPA fallback).

3. Editar `back/main.py`:
   - Después del bloque `if app_config.mode == AppMode.SERVER` que monta admin routes, agregar middleware ASGI o dependency global:
     - Opción A (preferida): `app.add_middleware(...)` con un middleware custom que filtra por path.
     - Opción B (fallback): pasar `dependencies=[Depends(server_auth_guard)]` a cada `include_router` solo en server mode.
   - Si optás por Opción A, crear `back/middleware/server_auth.py` y mantener `auth_guard.py` solo con la lógica de validación; el middleware llama a la lógica.
   - Si optás por Opción B, hay que repetir el `dependencies=` en cada include_router server-mode — más verboso pero más explícito.

4. Importante: NO romper modo ROBOT. El middleware/dep solo se monta dentro del `if app_config.mode == AppMode.SERVER`.

---

## Group 3: Tests

5. Crear `tests/test_auth_coverage.py`:
   - Test parametrizado: lista de rutas privadas (`/api/locations`, `/api/camellones`, `/api/sessions`, `/api/recordings/`, `/api/config/setup-status`, `/api/dashboard/stats`) → request sin Authorization header devuelve 401 en server mode.
   - Test: `/api/auth/login` y `/api/sync/health` siguen siendo accesibles sin auth en server mode.
   - Test: con JWT válido, las rutas privadas dejan de devolver 401 (200 o 404, pero no 401).
   - Test: en modo ROBOT (mock o fixture distinta), `/api/locations` sigue devolviendo 200 sin auth — comportamiento legacy preservado.
   - Reusar fixtures de `tests/conftest.py` (`client`, `setup_db`); para el caso server-mode, agregar fixture `server_client` que setea `ROBOT_MODE=server`.

6. Correr `uv run pytest` y `uv run ruff check back/`.

---

## Group 4: Documentación

7. Editar `back/routes/README.md` (crear si no existe):
   - Documentar el contrato: "en server mode toda ruta `/api/*` requiere JWT excepto la whitelist en `back/services/auth_guard.py`".
   - Lista de paths whitelist y por qué.
   - Cómo agregar una ruta pública nueva (editar la whitelist, justificar en commit).

8. Actualizar `spec/roadmap.md` Phase 22 marcándola Complete después del merge (eso lo hace `/spec-ship`, no este plan).
