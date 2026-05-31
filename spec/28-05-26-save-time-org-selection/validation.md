# Validation: selección de organización + camellón al guardar (modo robot)

La fase está lista para merge cuando todos los checks siguientes pasan.

## Automated Tests

- [ ] `cd front && pnpm tsc --noEmit` — sin errores de tipos
- [ ] `uv run alembic -c back/alembic.ini history` — cadena lineal `011→012→013→014→015` sin "overlaps"

### Cobertura específica requerida

- [ ] `uv run alembic -c back/alembic.ini upgrade head` sobre copia de `data/robot/robot.db` (que está en rev 012) — 013 y 014 corren como no-ops, 015 crea constraint compuesto sin error "Constraint must have a name"
- [ ] `PRAGMA index_list(camellones)` en SQLite muestra `uq_camellones_fundo_nombre` y ya no `sqlite_autoindex_camellones_1`
- [ ] `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head` en Postgres — 013 flipea `fruit_type_uuid` a nullable, 015 reemplaza `camellones_nombre_key` por el compuesto

## Manual Checks

- [ ] Sync online → `GET /api/device-context/` devuelve contexto efectivo con empresas/fundos del catálogo.
- [ ] Abrir SaveDialog → los tres selects (Empresa, Fundo, Camellón) cargan con los valores del contexto efectivo actual como default.
- [ ] Modo offline: abrir SaveDialog → las empresas y fundos del catálogo local aparecen; se puede crear empresa/fundo/camellón nuevos y guardar la sesión sin conexión.
- [ ] Guardar sesión → `active_context.json` se escribe con la empresa y fundo elegidos.
- [ ] Abrir SaveDialog de nuevo → los tres selects recuerdan la selección anterior (sticky).
- [ ] Forzar sync (`POST /api/sync/pull`) → `GET /api/device-context/` sigue devolviendo el contexto sticky (no lo pisa).
- [ ] Badge de contexto en VisionPage se actualiza inmediatamente tras guardar (no espera el intervalo de 60 s).
- [ ] Crear camellón con el mismo nombre en dos fundos distintos → ambos se crean sin error 409.
- [ ] Crear camellón con el mismo nombre en el mismo fundo → devuelve 409.
- [ ] Reconectar tras sesión offline → empresa/fundo/camellón creados offline aparecen en el server.

## Definition of Done

Todos los checks anteriores pasan, `pnpm tsc --noEmit` sin errores, sin `console.log` ni TODOs sin resolver en el diff.
