# Validation: Conteo diferido (counting worker)

La fase está lista para mergear a `master` cuando todo lo siguiente pasa.

## Automated Tests

Nota de entorno: los tests del backend viven en `tests/` (raíz). En esta Jetson
`PYTHONPATH` trae `/opt/ros/...`, que autocarga plugins pytest de ROS y rompe la
colección; correr con `PYTHONPATH=src` (reemplaza el heredado) lo aísla.

- [x] `PYTHONPATH=src uv run pytest` → 108 passed (2 fallos preexistentes en
      `test_wc_broadcaster.py`: NVENC/`NvVicCompose Failed`, hardware, ajenos).
- [x] `PYTHONPATH=src/counting_worker uv run pytest src/counting_worker/tests -o testpaths=`
      → 7 passed (paridad de `ObjectCounter`).
- [x] `cd src/front && npx tsc --noEmit` → 0 errores.
- [x] `uv run ruff check src/back src/counting_worker tests/test_counting_offline.py`
      → limpio en archivos nuevos (2 errores E402 preexistentes en
      `routes/auth.py`, no tocado).

### Specific test coverage required

- [~] `processor.count_video(...)` end-to-end sobre un MP4 → **check manual**
      (necesita GPU + engine; no corre en CI sin hardware).
- [x] `ObjectCounter` del worker: semántica de cruce de línea pinneada
      (`src/counting_worker/tests/test_object_counter.py`, 7 casos).
- [x] `counting_poller._process_worker_result(last_ok)` → `count_status='done'`,
      `count=total_count`, backfill de `Session.total_count`
      (`test_poller_transcribes_done_and_backfills_session`).
- [x] `counting_poller._process_worker_result(last_error)` → `count_status='error'`
      + `count_error`; y no pisa filas `done` (`test_poller_ignores_non_counting_row`).
- [x] `reconcile_orphaned_counts()` sin MP4 → `error`; sin `count_config` →
      `error` (`test_reconcile_marks_error_when_*`). Re-encola con worker vivo →
      check manual (necesita socket).
- [x] `POST /api/recordings/{uuid}/recount`: 404 uuid desconocido, 409 MP4
      ausente (`test_recount_404_*`/`test_recount_409_*`). 200 happy-path →
      check manual (necesita worker).
- [~] `stop_counting` persiste el pin de modelo en `count_config` y encola con
      ese `engine_path` → **check manual** (necesita worker + modelo activo).
- [~] `recount` reproduce con el engine fijado / `use_active_model=true` re-pin
      → **check manual**. La rama 409 (engine fijado ausente) está en
      `counting_trigger.enqueue_count` (marca `error`).
- [x] La migración Alembic `018` aplica up/down limpio en sqlite; las filas
      `recordings` existentes quedan con `count_status='none'`.

## Manual Checks

- [ ] Iniciar conteo → durante la sesión el overlay dibuja bboxes (validación
      visual), corre fluido (sin el tracker GMC en vivo) y **no** muestra un
      contador acumulado en vivo.
- [ ] Detener conteo → el `SaveDialog` muestra "Procesando conteo…", y en ~segundos
      aparece el número final; guardar la sesión funciona en cualquiera de los
      dos estados.
- [ ] Lista de sesiones: la fila recién creada muestra "procesando" y luego el
      conteo; `Session.total_count` coincide con el `count` del recording.
- [ ] Abrir el replay de detecciones de esa sesión → los bboxes quedan
      **alineados** con los arándanos del video frame a frame (sin arrastre).
- [ ] "Re-contar" sobre un video viejo → re-encola, regenera JSONL y conteo;
      el número se actualiza al terminar.
- [ ] Reiniciar el backend mientras un conteo está en `counting` → al arrancar,
      el job se re-encola (o queda `error` si falta el MP4); no queda colgado en
      `counting` para siempre.
- [ ] `make run-counting` levanta el worker; idle no consume GPU
      (`nvidia-smi`/`tegrastats` ~0% cuando no hay job).

## Rollback Criteria

Revertir si el conteo offline produce números sistemáticamente erróneos vs. el
conteo manual de referencia, o si el worker no procesa videos a un ritmo
aceptable (un MP4 típico de sesión no termina en pocos minutos).

## Definition of Done

Todos los checks anteriores marcados; el conteo en vivo ya no es autoritativo y
el número proviene del `counting-worker`; el replay de auditoría muestra cajas
alineadas; rama rebasada limpia sobre `master` sin código de depuración ni TODOs.
