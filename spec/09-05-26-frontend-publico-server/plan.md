# Plan: Frontend público vía server mode

## Group 1: Servir frontend desde FastAPI en modo SERVER

1. Editar `back/main.py`:
   - Importar `StaticFiles` de `fastapi.staticfiles` y `FileResponse` de `fastapi.responses`.
   - Después del bloque `if app_config.mode == AppMode.SERVER:` que monta los routers admin (línea ~96), agregar el bloque que sirve estáticos:
     - Definir `FRONT_DIST = Path(__file__).resolve().parent.parent / "front" / "dist"`.
     - Si `FRONT_DIST / "index.html"` no existe, log warning con texto `"front/dist no encontrado; correr 'make build-front'. La UI devolverá 503 hasta que exista."` y NO montar nada — la API queda disponible.
     - Si existe:
       - `app.mount("/assets", StaticFiles(directory=FRONT_DIST / "assets"), name="assets")` para los chunks de Vite.
       - Definir un catch-all `@app.get("/{full_path:path}")` que:
         - Si el path empieza con `api/` → re-lanza `HTTPException(status_code=404)` (no debería llegar acá si los routers están registrados, pero por defensa).
         - Si el path corresponde a un archivo concreto en `FRONT_DIST` (ej. `manifest.json`, `icon-192.svg`, `vite.svg`), devolver `FileResponse(FRONT_DIST / path)`.
         - Cualquier otra cosa → `FileResponse(FRONT_DIST / "index.html")` (SPA fallback).
   - El catch-all DEBE registrarse al final, después de todos los `include_router`, para no interceptar rutas de la API.

2. Verificar que la importación de `Path` ya existe en `back/main.py`. Si no, agregarla a los imports.

---

## Group 2: Documentación y flujo de uso

3. Editar el `README.md` de la raíz:
   - En la sección "Exponer el server a internet (Tailscale Funnel)", antes del subsection "Activar el acceso público", agregar un paso:
     - "Compilar el frontend antes de levantar el server: `make build-front`"
   - Mencionar que sin este paso el server arranca pero `https://<host>.ts.net/` devuelve 503 hasta que `front/dist/` exista.

4. Editar `deploy/README.md` para reflejar lo mismo en la guía de servidor (la sección `## Server (PC del laboratorio)`):
   - Agregar paso de `make build-front` en el flujo de instalación si no está ya.

---

## Group 3: Tests automatizados

5. Editar `tests/test_auth_endpoints.py` (o crear `tests/test_frontend_serve.py` si querés separar):
   - Test `GET /` → 200, content-type `text/html`, body contiene `<div id="root">` (o el marcador real de `front/dist/index.html`, verificar abriendo el archivo).
   - Test `GET /dashboard` → 200, mismo HTML que `GET /` (SPA fallback).
   - Test `GET /api/sync/health` → sigue siendo 200 con JSON (regresión).
   - Test `GET /assets/non-existent.js` → 404 (StaticFiles devuelve 404 para archivos que no están).
   - Los tests requieren que `front/dist/index.html` exista. Agregar una fixture en `tests/conftest.py` que cree un `index.html` mínimo con `<div id="root">` en `front/dist/` si no existe (en CI o entornos sin build), y cleanup al final.

6. Correr `uv run pytest` y `uv run ruff check back/` para verificar que no haya regresión.
