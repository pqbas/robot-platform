# Validation: Indicador de estado de upload en grabaciones

La fase está lista para merge cuando los checks automáticos pasan y los manuales están verificados en robot físico.

## Automated Tests

- [ ] `cd front && pnpm tsc --noEmit` sin errores nuevos en `RecordingsPage.tsx` ni `recordings.ts`.
- [ ] `uv run pyright back/routes/recordings.py back/services/sync_recordings_upload.py` sin errores nuevos.

## Manual Checks

- [ ] `GET /api/recordings/uploading` devuelve `{"uuids": []}` cuando no hay uploads en curso.
- [ ] Durante un upload activo: `GET /api/recordings/uploading` devuelve el UUID de la grabación en curso.
- [ ] En `RecordingsPage` (robot), la fila de una grabación en upload muestra el badge `subiendo`.
- [ ] Al completar el upload, la fila cambia a `subido` sin recargar la página (siguiente poll de 3s).
- [ ] Si `SYNC_LAN_URL` no está configurado, ninguna fila muestra `subiendo` (el upload está deshabilitado).

## Definition of Done

Todos los checks manuales verificados en robot físico con un upload activo. No hay regresiones en los badges `grabando`, `subido` y `pendiente`.
