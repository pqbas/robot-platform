# Validation: Inferencia YOLO con TensorRT

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `cd back && uv run python -c "from back.models import DetectionModel; print(DetectionModel.tensorrt_enabled.type, DetectionModel.engine_status.type, DetectionModel.engine_error.type)"` — las tres columnas existen y el tipo es el esperado.
- [ ] `cd back && uv run alembic upgrade head` — la migración nueva aplica sin errores en una DB limpia y en una DB existente con `004_simplify_model_schema` ya aplicada.
- [ ] `cd conversion_worker && uv run python -c "from conversion_worker.converter import convert; print(convert.__doc__ or 'ok')"` — el módulo importa sin error.
- [ ] `cd conversion_worker && uv run python -c "import tensorrt; print(tensorrt.__version__)"` — el venv tiene acceso a `tensorrt` (vía `--system-site-packages` en Jetson, falla esperada en dev sin GPU NVIDIA).
- [ ] `cd front && npm run lint && npx tsc --noEmit` — sin errores.

### Specific test coverage required

- [ ] `engine_path_for("data/robot/models/blueberry.pt", "abc123...")` devuelve `data/robot/models/blueberry.abc123....fp16.engine`.
- [ ] `engine_exists()` devuelve `False` cuando el `.engine` no está y `True` cuando está.
- [ ] `PUT /api/models/{uuid}/tensorrt` con `enabled=true` y `.engine` cacheado existente NO llama al worker, solo actualiza DB a `ready`.
- [ ] `PUT /api/models/{uuid}/tensorrt` con `enabled=true` y otra conversión en curso responde 409.
- [ ] `PUT /api/models/{uuid}/tensorrt` con `enabled=false` setea `engine_status='pytorch'` y deja el `.engine` en disco.
- [ ] El startup-reconciler convierte cualquier `engine_status='converting'` en disco a `error` con mensaje "Backend reiniciado durante conversión".

## Manual Checks

- [ ] En Jetson, instalar el `conversion-worker` service y correr `systemctl status conversion-worker` → activo, idle, 0% CPU/GPU.
- [ ] Asignar un modelo `.pt` al robot. Visitar `/settings` → "Modelos asignados" muestra el modelo con badge gris "PyTorch" y toggle off.
- [ ] Activar el toggle del primer modelo → badge cambia a "Convirtiendo..." con timer. `nvidia-smi` muestra GPU activa. Backend log muestra `engine_status='converting'`.
- [ ] Esperar 8 a 15 min en Jetson Xavier (medir y anotar en `conversion_worker/README.md` la duración real). Badge cambia a "TensorRT FP16" verde. El `.engine` aparece en `data/robot/models/`.
- [ ] Si el modelo convertido era el activo (vía `/select-label`), el inference-worker lo recargó automáticamente. `make logs-inference` muestra `Model reloaded: ...fp16.engine`.
- [ ] Iniciar una sesión de conteo con el modelo en TensorRT → FPS observado en `make logs-inference` (o en el frontend si hay un display) sube vs el modelo en PyTorch. Anotar el ratio en `conversion_worker/README.md`.
- [ ] Activar TensorRT en un segundo modelo mientras el primero está convirtiendo → toast "Conversión en curso, espera". DB no cambia.
- [ ] Desactivar el toggle de un modelo en estado `ready` → badge vuelve a "PyTorch", `.engine` sigue en disco. Re-activar inmediatamente → salta directo a `ready` (no reconvierte).
- [ ] Re-subir el `.pt` (cambia `file_hash`) y reactivar TensorRT → reconvierte (nuevo `.engine` con el nuevo hash en el nombre).
- [ ] Matar el `conversion-worker` con SIGKILL en pleno medio de una conversión, reiniciar backend → el modelo afectado pasa a `error` "Backend reiniciado durante conversión", reintentar funciona.
- [ ] En modo server (`ROBOT_MODE=server`), `/api/models` devuelve 404 y la card no aparece en `/settings`.

## Post-deploy Checks

- [ ] En el robot productivo, primer modelo convertido: medir tiempo y FPS antes/después, anotar en `conversion_worker/README.md`.
- [ ] `journalctl -u conversion-worker -f` no muestra errores recurrentes ni restarts en las primeras 24h.
- [ ] Espacio en disco bajo `data/robot/models/` se mantiene razonable (un `.engine` por modelo asignado, no se acumulan archivos huérfanos).

## Rollback Criteria

Si la conversión rompe el inference-worker en producción (por ejemplo el `.engine` cargado crashea ultralytics o degrada FPS por debajo del live actual con `.pt`), el operador desactiva el toggle desde `/settings` (vuelve a PyTorch sin reiniciar nada). Si el conversion-worker se vuelve loco (ciclos de restart, GPU OOM), `systemctl stop conversion-worker` aísla el problema sin tocar el resto.

## Definition of Done

Todas las cajas arriba marcadas, branch rebased contra `master`, sin `console.log` ni `print` de debug, las 4 cajas de Phase 11 en `spec/roadmap.md` marcadas `[x]`, y al menos un modelo convertido y validado en Jetson con FPS medido antes/después.
