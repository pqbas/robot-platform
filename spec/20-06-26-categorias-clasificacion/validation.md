# Validation: Categorías como centro + clasificación post-conteo

La fase está lista para mergear a `master` cuando todo lo siguiente pasa.

## Automated Tests

Nota de entorno: los tests del backend corren con `PYTHONPATH=src` (aísla los
plugins pytest de ROS que `/opt/ros` autocarga en esta Jetson).

- [ ] `PYTHONPATH=src uv run pytest` → sin fallos nuevos (los 2 preexistentes de
      NVENC en `test_wc_broadcaster.py` siguen siendo los únicos).
- [ ] `PYTHONPATH=src/classification_worker uv run pytest src/classification_worker/tests -o testpaths=`
      → verde (preprocesado + parseo de crossings).
- [ ] `PYTHONPATH=src/counting_worker uv run pytest src/counting_worker/tests -o testpaths=`
      → verde (incluye el nuevo delta-de-cruces de `ObjectCounter`).
- [ ] `cd src/front && npx tsc -b` → 0 errores.
- [ ] `uv run ruff check src/back src/classification_worker src/counting_worker`
      → limpio en archivos nuevos/tocados.

### Specific test coverage required

- [ ] `build_count_config(target_class)` resuelve el detector desde
      `Category(name=target_class).detection_model_uuid` y **toda la geometría**
      (method + count_mode/threshold/direction/roi_mode/confidence) desde la
      categoría; los `overrides` siguen ganando; `RuntimeError("no_category")` si
      no hay categoría/detector.
- [ ] `ObjectCounter.update(...)` devuelve el **delta** de `track_id` que cruzaron
      en esa llamada; un track ya contado no reaparece en el delta.
- [ ] `classify_video(payload)` sobre un MP4 + `crossings.jsonl` de fixture →
      N crops JPG, N líneas en `classifications.jsonl`, `distribution` cuya suma =
      N (con `SupervisedModel` aleatorio; valida pipeline, no precisión).
- [ ] Preprocesado del worker: crop BGR→RGB, resize 128×128 por estiramiento,
      tensor [0,1] sin normalización (test sobre imagen conocida).
- [ ] `build_classification_config(rec)` → `None` cuando la categoría contada no
      tiene `classification_model_uuid`; snapshot con el pin correcto cuando sí.
- [ ] `classification_poller._process_worker_result(ok)` → crea `FruitCrop`
      (con `recording_uuid`) + `FruitClassification` por crop, `done`,
      `classifications_uploaded_at=None`.
- [ ] `classification_poller._process_worker_result(error)` → `error` +
      `classification_error`; no pisa filas `done`.
- [ ] `reconcile_orphaned_classifications()` sin MP4 / sin `.pt` del pin → `error`;
      con todo presente → re-encola.
- [ ] counting-poller, al marcar `count_status='done'`, llama
      `enqueue_classification` solo cuando la categoría tiene clasificador (mock).
- [ ] La migración aplica up/down limpio en sqlite; el **backfill** crea filas
      `categories` desde `counting_methods.json`/`selected_label`; filas
      `recordings` existentes quedan con `classification_status='none'`.
- [ ] Sync: `FruitClassification`/`FruitCrop` en el push solo con
      `classifications_uploaded_at IS NULL`; JPG solo con `crops_uploaded_at IS NULL`.

## Manual Checks

- [ ] En el server, vista de Categorías: crear/abrir la categoría `arandano`,
      elegir su detector y subir+asignar su clasificador → la categoría muestra
      ambos.
- [ ] Forzar sync en el robot → `categories`, el `.pt` del clasificador y la
      metadata llegan (`data/robot/models/` + tabla `categories`).
- [ ] Configurar la geometría de `arandano` (ej. línea horizontal 0.5,
      left2right) distinta a la de `persona` (ej. vertical, top2down) → cada conteo
      usa la geometría de su propia categoría.
- [ ] Contar eligiendo la categoría `arandano` → el conteo usa el detector y la
      geometría de la categoría (no `select-label` ni `config.counting`); el número
      coincide con lo esperado.
- [ ] Al quedar `count_status='done'`, el recording pasa a `classifying` → `done`;
      se generan crops en disco. Una categoría **sin** clasificador no dispara el
      worker (0% GPU).
- [ ] Sesión/grabación en la UI → resumen de distribución + galería de crops con
      clase + confianza; nº de crops ≈ `total_count`; cada crop corresponde
      visualmente al objeto en el frame del cruce.
- [ ] Resultados suben **solos** al server; el video + crops suben **solo** con el
      botón de subida de la sesión.
- [ ] Reiniciar el backend con un recording en `classifying` → se re-encola (o
      `error` si falta MP4/`.pt`); no queda colgado.
- [ ] `make run-classification` levanta el worker; idle no consume GPU.
- [ ] Convivencia: con dos categorías de detectores distintos, ambos detectores
      activos se sincronizan (biblioteca) y cada categoría usa el suyo.
- [ ] (Precisión, con el checkpoint real) las etiquetas de madurez de una muestra
      de crops coinciden con el juicio manual; orden índice→nombre correcto.

## Rollback Criteria

Revertir si el conteo deja de funcionar al resolver el modelo por categoría
(regresión sobre un camino que hoy funciona), si la clasificación bloquea/corrompe
el conteo, si los crops se desalinean sistemáticamente, o si la subida de crops
satura el uplink al punto de romper el sync del video.

## Definition of Done

Todos los checks marcados; el conteo resuelve su detector por categoría sin
regresión; una categoría con clasificador produce resumen + galería de crops;
resultados suben automático y crops/video con el botón de sesión; el frontend
gira alrededor de categorías; rama rebasada limpia sobre `master` sin código de
depuración ni TODOs. La validación de **precisión** real queda pendiente del
checkpoint del usuario (no bloquea el merge del pipeline, sí su uso en producción).
</content>
