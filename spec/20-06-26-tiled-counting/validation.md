# Validación: conteo con tiling

## Checks automáticos

- `cd src/front && npx tsc --noEmit` → 0 errores de tipo.
- `cd src/back && uv run ruff check` → limpio en archivos tocados.
- `cd src/counting_worker && uv run pytest` → pasa, incluyendo:
  - test de geometría del tiling: dado un frame WxH, `_center_strip_tiles`
    produce 2 tiles cuadrados de lado `min(H,W)//2`, y el remapeo de una caja en
    coords de tile vuelve a los píxeles de frame completo esperados (superior con
    `y+0`, inferior con `y+half`, ambos con `x += x_off + (side-half)//2`).

## Checks manuales (con GPU + engine en el robot)

- `make run-counting` idle → 0% GPU.
- Objeto nuevo en counting-methods → default `single`.
- Fijar `tiled` para "arándano" en ajustes → persiste tras reiniciar backend.
- Re-procesar una grabación con `tiled`: fila pasa a "procesando" → muestra el
  número; `tegrastats` muestra GPU solo durante el job.
- Replay de esa grabación: cajas alineadas frame a frame dentro de la franja
  central (no fuera de ella); el conteo acumulado sube al cruzar.
- Re-procesar la **misma** grabación con `single` → el número y el overlay
  coinciden con el comportamiento actual (sin regresión).
- En el diálogo, al elegir `tiled` se ocultan/deshabilitan modo, línea y ROI; al
  volver a `single` reaparecen.

## Definition of Done

El worker cuenta con `tiled` y `single`; el método se fija por objeto (default
`single`) y se puede cambiar al re-procesar; el sidecar/replay queda alineado en
ambos métodos; sin regresión en `single` ni en el overlay en vivo.
