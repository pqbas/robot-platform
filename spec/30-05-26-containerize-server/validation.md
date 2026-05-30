# Validation: Containerize server

La fase está lista para mergear cuando todos los checks abajo pasan en un
host Linux limpio con Docker 24+ instalado y `.env.server` provisto.

## Automated Tests

- [ ] `docker compose -f docker-compose.server.yml config` exit 0 sin
      warnings de campos desconocidos.
- [ ] `docker compose -f docker-compose.server.yml build` exit 0 para los
      stages `back` y `front`.
- [ ] `uv run pytest` exit 0 (suite existente sigue verde, no se cambió
      código de aplicación).
- [ ] `uv run ruff check back/` exit 0.

### Specific test coverage required

No se agregan tests nuevos en esta fase. La fase es puramente de packaging;
el comportamiento del backend, frontend y base de datos no cambia. Si algún
test existente requiere ajuste por paths absolutos (ej. `/app/...`), se
documenta como hallazgo y se trata en una fase posterior.

## Manual Checks

- [ ] `docker compose -f docker-compose.server.yml up -d postgres tailscale`
      → `docker compose ... ps` muestra `postgres` `healthy` y `tailscale`
      `running` en <30s.
- [ ] `docker compose ... exec tailscale tailscale status` muestra el
      nodo autenticado (no `NeedsLogin`).
- [ ] `docker compose ... exec tailscale tailscale funnel status` lista
      `:443` activo apuntando a `http://nginx:80`.
- [ ] `docker compose ... run --rm back alembic -c back/alembic.ini upgrade
      head` exit 0; `alembic_version` en revisión `head`.
- [ ] `docker compose ... run --rm back python -m back.scripts.create_admin`
      crea un admin y `users` queda con 1 fila.
- [ ] `docker compose ... up -d` deja `back`, `nginx`, `postgres`,
      `tailscale` en `running` y `front` exited 0.
- [ ] `curl https://${TS_HOSTNAME}/api/sync/health` desde una red ajena
      al host devuelve 200 con `{"status": "ok"}`.
- [ ] `curl https://${TS_HOSTNAME}/api/dashboard/stats` devuelve 401.
- [ ] `curl https://${TS_HOSTNAME}/` devuelve 200 con HTML del frontend
      (presencia de `<div id="root">`).
- [ ] `curl http://localhost/` desde el host devuelve 200 con el mismo
      HTML del frontend (acceso LAN HTTP plano).
- [ ] `curl http://localhost/api/sync/health` devuelve 200 (path LAN
      funciona end-to-end al `back`).
- [ ] Login en `https://${TS_HOSTNAME}/` con admin creado devuelve JWT y
      permite ver dashboard.
- [ ] `docker compose ... logs back` no muestra stack traces ni warnings
      de CORS / DB durante el login.
- [ ] `docker compose ... down` deja todo limpio; `docker compose ... up
      -d` rehidrata sin pedir setup (volúmenes `pgdata`, `ts-state`
      intactos, sin re-autenticar Tailscale).
- [ ] `docker compose ... down -v` borra volúmenes; siguiente `up -d`
      requiere migrar y re-crear admin, y un `TS_AUTHKEY` nuevo o
      reusable.

## Post-deploy Checks

Esta fase no se promueve a producción todavía (decisión "coexisten" queda
abierta). Cuando se promueva, los checks de post-deploy se definen en una
fase futura.

## Definition of Done

Todos los checks de "Automated Tests" y "Manual Checks" arriba están
marcados. La rama `feat/containerize-server` no introduce cambios al código
de `back/`, `front/` ni `deploy/*.service`. `spec/tech-stack.md` refleja la
nueva opción de orquestación. El usuario confirma que un `docker compose
up -d` desde host limpio levanta el server end-to-end.
