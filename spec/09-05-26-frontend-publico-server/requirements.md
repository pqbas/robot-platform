# Requirements: Frontend público vía server mode

## Scope

El backend FastAPI en modo `SERVER` sirve el frontend React (`front/dist/`) en la misma URL pública que ya expusimos en Phase 18. Cuando un usuario abre `https://<host>.ts.net/`, recibe la app SPA; las rutas client-side (`/login`, `/dashboard`, etc.) cargan correctamente al recargar el navegador. Las rutas `/api/*` siguen funcionando igual.

Fuera de scope:
- No se toca el modo `ROBOT`. El operador del robot sigue accediendo al frontend por Vite dev server o por el nginx ya configurado en `deploy-robot`.
- No se reemplaza el nginx del `install.sh server`. Ese path queda intacto como deploy de producción opcional para cuando haya tráfico real (escalado, caching de estáticos serios, etc.).
- No se agrega CDN, compresión gzip/brotli, ni cache headers customizados. FastAPI sirve los archivos como están en `front/dist/`.
- No se automatiza el build del frontend dentro de `run-server`. El usuario corre `make build-front` antes de `make run-server` (o el deploy lo hace).

## Behavior

- `GET /` devuelve `front/dist/index.html` con HTTP 200.
- `GET /assets/<file>`, `GET /icon-192.svg`, `GET /manifest.json`, etc. devuelven los archivos estáticos de `front/dist/`.
- `GET /api/<...>` sigue resolviendo en los routers de FastAPI (sin regresión vs Phase 18).
- `GET /<ruta-client-side>` (ej. `/login`, `/dashboard`, `/vision`) devuelve `index.html` con HTTP 200, para que el SPA router del frontend tome control. Esto se llama "SPA fallback".
- Si el server arranca en modo `SERVER` y `front/dist/index.html` no existe, loguea un error claro indicando "correr `make build-front` antes de levantar el server" y arranca de todas formas (la API funciona, el frontend devuelve 503 hasta que el build aparezca).
- En modo `ROBOT`, el comportamiento no cambia: las rutas que no son `/api` siguen yendo a donde iban antes (Vite dev server o nginx en deploy-robot).

## Decisions

- **FastAPI sirve estáticos directamente, sin nginx en este path** — Phase 18 dejó nginx armado para `install.sh server` pero solo aplica al deploy completo de producción. Para que el flujo de "laptop o lab PC con `make run-server` + Tailscale Funnel" entregue UI sin pasar por nginx, FastAPI debe servir `front/dist/`. Es código ~20 líneas y no escala a tráfico real, pero el lab no necesita eso por ahora.
- **SPA fallback con catch-all route en lugar de `StaticFiles(html=True)`** — `StaticFiles(html=True)` solo sirve `index.html` cuando la ruta termina en `/`, no cuando es `/dashboard` directamente. Necesitamos un catch-all explícito que devuelva `index.html` para cualquier ruta no-API y no-asset.
- **Solo se monta en modo `SERVER`** — el frontend en modo `ROBOT` lo sirve nginx (deploy-robot) o Vite (`make run-front`), montar `StaticFiles` ahí rompería el dev workflow del operador.
- **No auto-build en `run-server`** — meter `npm run build` dentro de `make run-server` lo vuelve lento (`vite build` toma 10–30s) y mezcla concerns. El usuario hace `make build-front` cuando cambió el frontend; si no, reutiliza el build anterior.
- **Fail-soft si falta `front/dist/`** — el server arranca igual y la API funciona. Es preferible a un crash al boot, porque el operador puede estar haciendo deploy en pasos (instala server primero, build frontend después).
- **No se agregan cache headers ni compresión** — son útiles para producción seria, pero acá el cliente es 1 operador en 4G con la pestaña abierta. Si el front/dist crece a punto de doler, se mete nginx (que es lo que `install.sh server` ya hace).

## Context

- See `spec/06-05-26-acceso-publico-server-auth/` — Phase 18 expuso el backend; esta fase agrega el frontend al mismo flujo.
- See `spec/roadmap.md` — Phase 19.
- Existing patterns to follow:
  - `back/main.py` — donde se montan los routers; `app_config.mode == AppMode.SERVER` ya se usa para condicionar rutas server-only.
  - `front/dist/` — el build de Vite ya existe; `make build-front` lo regenera.
  - `deploy/nginx.conf.template` — referencia de cómo se hace el SPA fallback en producción (`try_files $uri $uri/ /index.html`).
