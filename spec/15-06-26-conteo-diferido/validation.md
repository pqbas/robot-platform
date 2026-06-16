# Validation: Conteo diferido (counting worker)

La fase está lista para mergear a `master` cuando todo lo siguiente pasa.

## Automated Tests

- [ ] `cd src/back && uv run pytest` exits 0 con no failures
- [ ] `cd src/counting_worker && uv run pytest` exits 0 (tests del processor)
- [ ] `cd src/front && npx tsc --noEmit` exits 0 sin errores de tipo
- [ ] `cd src/back && uv run ruff check` exits 0

### Specific test coverage required

- [ ] `processor.count_video(...)` sobre un MP4 sintético con N objetos cruzando
      la línea devuelve `total_count == N` y escribe un JSONL con una línea por
      frame del video (mismo conteo de frames que el MP4).
- [ ] `ObjectCounter` copiado al worker da el mismo conteo que el del backend
      para la misma secuencia de `tracking_data` (test de paridad).
- [ ] `counting_poller._process_worker_result(last_ok)` con un `Recording` en
      `counting` lo deja en `count_status='done'`, `count=total_count`, y hace
      backfill de `Session.total_count` en la sesión vinculada por `recording_uuid`.
- [ ] `counting_poller._process_worker_result(last_error)` deja
      `count_status='error'` y `count_error` poblado.
- [ ] `reconcile_orphaned_counts()` con un `Recording` en `counting` y MP4 en
      disco lo re-encola; sin MP4 lo marca `error`.
- [ ] `POST /api/recordings/{uuid}/recount` re-encola y devuelve 200; 404 si el
      uuid no existe; 409 si el MP4 no está en disco.
- [ ] `stop_counting` persiste en `count_config` la identidad del modelo activo
      (`model_uuid`, `model_version`, `file_hash`, `engine_path`); el job se
      encola con ese `engine_path`.
- [ ] `recount` por defecto reutiliza el `engine_path` fijado (reproducible) y
      devuelve 409 si ese engine ya no está en disco; con `use_active_model=true`
      re-snapshotea el modelo activo y encola con su engine.
- [ ] `reconcile_orphaned_counts()` marca `error` (no re-encola) cuando el
      `engine_path` del `count_config` ya no existe en disco.
- [ ] La migración Alembic aplica up/down limpio y las filas `recordings`
      existentes quedan con `count_status='none'`.

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
