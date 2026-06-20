# Plan: conteo con tiling seleccionable por objeto

## Grupo 1 — Worker: método `tiled` en el processor

- `src/counting_worker/counting_worker/processor.py`:
  - Refactor: `count_video(payload)` lee `method = payload.get("method", "single")`
    y despacha a `_count_single(...)` (el código actual, renombrado) o
    `_count_tiled(...)`. Ambos escriben el **mismo** formato JSONL y devuelven
    `{total_count, frames}`.
  - `_count_tiled`: por frame → `_center_strip_tiles(frame)` (cuadrado central →
    franja central ancho=lado/2 → 2 tiles cuadrados apilados). `model_top` /
    `model_bottom` = `YOLO(engine, task="detect")` (2 instancias). Cada tile:
    `model.track(tile, conf, persist=True, tracker="bytetrack.yaml")`. 2
    `ObjectCounter("horizontal", 0.5, direction)`. Filtra por `target_class`.
  - **Remapeo a frame completo** para el JSONL: `strip_x0 = x_off + (side-half)//2`;
    tile superior `y += 0`, tile inferior `y += half`. Las cajas se escriben en
    píxeles de frame completo (igual que `_count_single`), `count` = suma de los 2
    contadores.
  - Coerción defensiva: en `tiled`, `count_mode→horizontal`, `roi→square`,
    `threshold→0.5`; si `direction` no es izq/der → `left2right`.
- `src/counting_worker/counting_worker/main.py`: pasar `method` del payload a
  `count_video` (ya pasa el payload completo; solo documentar el campo en el
  docstring del protocolo).
- `src/counting_worker/tests/`: test de geometría del tiling (offsets de remapeo
  superior/inferior) sin GPU.

## Grupo 2 — Backend: `method` en config + persistencia por-objeto

- `src/back/config.py`: `CountingConfig.method: str = "single"` (default global;
  el per-objeto lo overlaya).
- `src/back/services/counting_methods.py` (nuevo, espejo de
  `counting_settings.py`): `read_method(model_uuid, label) -> str`,
  `set_method(model_uuid, label, method)`, `read_all() -> dict`. Archivo
  `data/robot/counting_methods.json`, mapa `"{model_uuid}::{label}" -> method`.
  Validación: method ∈ {single, tiled}; default `single`.
- `src/back/config.py` / storage: ruta `counting_methods_path`.
- `src/back/services/perception/counting_trigger.py`:
  - `build_count_config`: resolver `method` del objeto
    (`counting_methods.read_method(model.uuid, target_class)`), permitir override
    por `overrides["method"]`. Incluir `method` en el dict devuelto.
  - `enqueue_count`: pasar `method` al `CountingClient.count(...)`.
- `src/back/services/perception/counting_client.py`: `count(..., method=...)` en el
  payload al worker.

## Grupo 3 — Backend: endpoints

- `src/back/schemas.py`: `method` en `RecountConfig`/preview y en
  `CountingConfigOut/Update` si aplica; nuevos `CountingMethodOut/Update`.
- `src/back/routes/config_routes.py`:
  - `GET /api/config/counting-methods` → lista de objetos (counting-options) con
    su método actual (default `single`).
  - `PUT /api/config/counting-methods` → fija método de un objeto.
  - `counting-options` / preview de recount: incluir `method`.
- `src/back/routes/recordings.py`: el preview de recount (`getRecountConfig`)
  devuelve `method`; `recountWithConfig` acepta `method` en overrides.

## Grupo 4 — Frontend

- `src/front/src/api/config.ts`: tipos + `getCountingMethods()` /
  `setCountingMethod()`.
- `src/front/src/api/recordings.ts`: `method` en `RecountConfig`.
- `src/front/src/modules/map/components/RecountConfigDialog.tsx`: selector
  "Método de conteo" (Single / Tiled). En `tiled`, ocultar/deshabilitar
  count_mode, threshold y ROI (fijos) con una nota; dejar dirección + confianza.
- Ajustes de conteo (página de settings): sección "Método por objeto" que lista
  los counting-options con un toggle Single/Tiled por objeto.

## Verificación

- `cd src/front && npx tsc --noEmit` → 0 errores.
- `cd src/back && uv run ruff check` → limpio en archivos nuevos/tocados.
- `cd src/counting_worker && uv run pytest` → test de geometría del tiling pasa.
- Manual (con GPU + engine): re-procesar una grabación de arándanos con `tiled`
  → la fila muestra "procesando" → número; replay con cajas alineadas dentro de
  la franja central; `single` sigue idéntico; default de objeto nuevo = `single`.
