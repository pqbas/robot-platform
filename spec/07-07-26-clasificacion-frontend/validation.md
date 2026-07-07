# Validation: Frontend de visualización de clasificación de madurez

La fase está lista para mergear cuando todo lo siguiente pasa.

## Automated Tests

- [ ] `cd src/front && npx tsc --noEmit` termina sin errores de tipo.
- [ ] `cd src/back && uv run ruff check` limpio en los archivos tocados.
- [ ] Desde `src/back`, `PYTHONPATH=src uv run pytest` verde (sin regresiones).

### Specific test coverage required

- [ ] `GET /api/recordings/{uuid}/crops/{filename}` con un crop existente → 200 y
  `Content-Type: image/jpeg`.
- [ ] `GET /api/recordings/{uuid}/crops/{filename}` con filename inexistente → 404.
- [ ] `GET /api/recordings/{uuid}/crops/{filename}` con filename que contiene `..`
  o separadores de ruta → rechazado (400/404), no sirve archivos fuera del dir de
  crops.
- [ ] `list_sessions` / `get_session` exponen `classification_status` en
  `SessionOut` (== el `classification_status` de la grabación vinculada; `none`
  cuando no hay grabación).

## Manual Checks

- [ ] Contar una grabación de una categoría **con** clasificador asignado y dejar
  correr la clasificación → en `SessionsTable` la columna "Madurez" pasa de
  "clasificando…" a "madurez ✓".
- [ ] Abrir el detalle de esa sesión → aparece la sección "Madurez" con las barras
  de distribución (los conteos suman el total) y la galería de recortes; cada
  miniatura carga su JPG y muestra etiqueta + % de confianza.
- [ ] Sesión de una categoría **sin** clasificador (opt-out) → la columna
  "Madurez" muestra "—" y la sección "Madurez" del detalle **no** se renderiza
  (no ocupa espacio ni sugiere que "falta clasificar").
- [ ] (Robot) Botón "Re-clasificar" → toast de éxito y la distribución/galería se
  refrescan.
- [ ] (Robot) Re-clasificar una sesión no contada o cuya categoría no tiene
  clasificador → toast de error legible (no crash, no pantalla en blanco).
- [ ] Una miniatura cuyo JPG no existe en disco → imagen rota tolerable (no
  reventar la galería); el resto de miniaturas siguen cargando.
- [ ] Server mode: la sección "Madurez" se ve (distribución + galería), pero el
  botón "Re-clasificar" **no** aparece.

## Definition of Done

Todos los checks anteriores marcados; `npx tsc --noEmit` y `ruff` limpios; sin
`console.log` ni TODO de depuración; el indicador de la tabla y la sección del
detalle se comportan correctamente en los cuatro estados (`none`/`classifying`/
`done`/`error`) tanto en robot como en server.
