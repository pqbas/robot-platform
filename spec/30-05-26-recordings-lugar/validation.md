# Validación

## Migración
- [ ] `uv run alembic -c back/alembic.ini history` muestra cadena lineal hasta `016` sin "overlaps".
- [ ] `upgrade head` sobre copia de `data/robot/robot.db` aplica `016` sin error; re-correr es no-op (guard).
- [ ] `PRAGMA table_info(recordings)` incluye `camellon_id`.
- [ ] Las ~10 grabaciones existentes siguen ahí, con `camellon_id = NULL`.

## Backend
- [ ] `GET /api/recordings/` devuelve `camellon_id`, `camellon_nombre`, `fundo_uuid`.
- [ ] `GET /api/recordings/?fundo_uuid=<uuid>` filtra correctamente; `?camellon_id=` también; combinables con `from/to/device_id`.
- [ ] `PUT /api/recordings/{uuid}/place` con `camellon_id` válido setea el lugar; con `null` lo quita; con id inexistente → 4xx.
- [ ] Typecheck/sintaxis backend OK.

## Sync (robot ↔ server)
- [ ] Grabar con lugar → forzar sync push → en el server la grabación llega con el camellón resuelto (mismo fundo/empresa).
- [ ] **Regresión clave:** editar el lugar de una grabación **ya sincronizada** → forzar sync → el server refleja el nuevo lugar (se re-empujó). Si no cambia, el re-marcado de `sync_log` falla.
- [ ] Recibir en robot una grabación cuyo camellón aún no existe localmente → no falla; queda `camellon_id=NULL`.

## Frontend
- [ ] `tsc --noEmit -p tsconfig.app.json` limpio; `npm run build` OK.
- [ ] Al detener una grabación aparece el diálogo con empresa/fundo/camellón preseleccionados (contexto activo).
- [ ] **Guardar lugar** → la grabación queda etiquetada; **Omitir** → queda sin lugar.
- [ ] En Grabaciones: columna Lugar visible; filtros Empresa/Fundo en cascada (sin combinaciones vacías, reset de hijo obsoleto).
- [ ] Botón editar lugar en una fila (incl. una de las viejas sin lugar) → asigna/corrige y refresca.
- [ ] El `SaveDialog` de sesiones sigue funcionando igual (no regresión por extraer la cascada).

## Manual end-to-end
1. Setear contexto activo a Empresa A / Fundo X / Camellón Y.
2. Grabar 10s → detener → diálogo preseleccionado en A/X/Y → Guardar.
3. Grabaciones: la fila muestra "X / Y"; filtrar por Fundo X la incluye, por otro fundo no.
4. Editar esa fila a Camellón Z (otro fundo) → se actualiza; el filtro la sigue al nuevo fundo.
5. Grabar otra y **Omitir** → aparece "— (sin lugar)".
6. Asignarle lugar desde la lista → queda etiquetada.
