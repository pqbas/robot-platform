# Requirements: Indicador de estado de upload en grabaciones

## Scope

En `RecordingsPage` (modo robot), cada fila de grabación muestra uno de cuatro estados: `grabando`, `subiendo`, `subido`, o `pendiente`. El estado `subiendo` refleja que el sync loop está transfiriendo ese archivo en este momento. La tabla ya tiene `grabando`, `subido` y `pendiente`; esta fase agrega `subiendo`.

## Behavior

- El backend mantiene en memoria el conjunto de UUIDs que se están subiendo actualmente (`_uploading_uuids: set[str]` en `sync_recordings_upload.py`).
- Un nuevo endpoint `GET /api/recordings/uploading` devuelve `{"uuids": [...]}`.
- El frontend lo consulta cada 3 segundos mientras la página está abierta.
- Las filas cuyos UUIDs aparecen en la respuesta muestran el badge `subiendo` en lugar de `pendiente`.
- Cuando el upload termina (exitoso o fallido), el UUID sale del conjunto y el badge vuelve a `pendiente` o cambia a `subido`.

## Decisions

- **Estado en memoria, no en DB** — el estado `subiendo` es completamente transitorio (dura segundos o minutos); persistirlo en DB añade complejidad sin beneficio real.
- **Polling cada 3s, no SSE/WebSocket** — los cambios de estado son poco frecuentes y el costo de polling ligero es despreciable. Evita agregar infraestructura de push.
- **Endpoint sin auth en robot mode** — sigue el patrón de los endpoints públicos del robot (ver `back/routes/README.md`); el dato es de baja sensibilidad.
- **Solo modo robot** — en server mode no hay sync loop de upload activo, así que el endpoint devuelve `{"uuids": []}` pero el badge `subiendo` nunca aparecería.

## Context

- `back/services/sync_recordings_upload.py` — agregar `_uploading_uuids` y actualizar en `_upload_one`.
- `back/routes/recordings.py` — agregar endpoint `GET /uploading`.
- `front/src/modules/recordings/RecordingsPage.tsx` — `RowStatus` ya tiene la estructura; agregar `"uploading"` y el polling.
- `front/src/api/recordings.ts` — agregar `getUploadingUuids()`.
