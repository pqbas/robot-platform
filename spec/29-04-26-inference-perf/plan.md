# Plan: Optimización de latencia de inferencia

Reducir el tiempo total por frame de inferencia. El objetivo concreto: **bajar de 52 ms (TRT actual con `model.track()`) a ≤15 ms**, lo que devuelve la inferencia a su rango "razonable" para YOLO11n FP16 en Xavier AGX y deja al robot en 60+ fps efectivos.

Documento gemelo: `current-state.md` (mediciones de baseline).

## Principios

1. **No optimizar sin medir.** Cada paso debe producir una medición antes/después con `make bench-inference`. Sin eso no sabemos qué movió el número.
2. **Bajar de capa solo cuando los datos lo justifiquen.** No reescribir el inference path por gusto — solo si el wrapper de ultralytics es realmente el bottleneck.
3. **Mantener compatibilidad.** El protocolo del worker (Unix socket, formato de detecciones) no cambia. El cambio es interno al `Detector`.

## Group 1: Diagnóstico fino del overhead de `model.track()`

Antes de reescribir nada, identificar exactamente dónde se van los ~27 ms del gap.

1. **Wrap interno de `model.track()` con sub-timers** en `inference_worker/detector.py`:
   - Tiempo desde `t0` hasta antes de `self._model.track(...)` (slicing del ROI).
   - Tiempo del call `model.track()` puro.
   - Tiempo desde el return de `model.track()` hasta el final del `detect()` (mapeo de bboxes, construcción del dict de respuesta).
   - Reportar como sub-stages adicionales en el log de `perf`.

2. **Comparar `model.track()` vs `model.predict()`** sobre los mismos frames.
   - Hipótesis: `track()` agrega ~5–15 ms vs `predict()` por la asociación + Kalman.
   - Si la diferencia es chica, el wrapper en sí es el overhead, no el tracker.
   - Si es grande, ByteTrack es el problema y atacamos ahí.

3. **Profilear con cProfile** un run de 60 frames para ver dónde se va el tiempo Python-side.
   - `python -m cProfile -o /tmp/inf.prof -m inference_worker.main ...` (modo offline con frames sintéticos).
   - Visualizar con `snakeviz` o `gprof2dot`.

4. **Verificar contention con `tegrastats`** durante una corrida normal.
   - Si `GR3D_FREQ` no está cerca del 100%, el bottleneck no es la GPU.
   - Si CPU cores están saturados (4+ al 100%), el problema es CPU contention con otros workers.

**Entregable:** un breakdown claro de a dónde se van los 52 ms, con porcentajes por componente. Output ejemplo:
```
preprocess (cpu)         5 ms
inference (gpu)         16 ms
postprocess + nms (cpu)  3 ms
ultralytics wrapper     12 ms   ← novedad
bytetrack association    8 ms   ← novedad
result construction      5 ms   ← novedad
roi crop + dict map      3 ms   ← novedad
TOTAL                   52 ms
```

## Group 2: Eliminar el overhead del wrapper

Una vez identificado el bottleneck, atacarlo. Opciones por escalada de invasividad:

### 2a. (mínimo cambio) Streaming predict + ByteTrack persistente

- Reemplazar `self._model.track(roi, persist=True)` por:
  - Un `Predictor` instanciado una sola vez en `__init__` / `reload_model`.
  - Cada frame: `predictor(roi)` retorna boxes; ByteTrack instancia separada gestiona IDs.
- Ultralytics expone `model.predict(stream=True, ...)` que tiene overhead per-call mucho menor.
- ByteTrack se carga directo de `ultralytics.trackers.byte_tracker.BYTETracker`.
- **Esperado:** baja de 52 ms a ~25–30 ms.

### 2b. (intermedio) Llamada directa al backend de ultralytics

- Bypass `predict()` y llamar directo a `model.predictor.inference(im)`.
- Eso entrega tensors crudos; postprocess (NMS, decode) lo hacemos nosotros con torchvision o ops directas.
- **Esperado:** baja a ~15–20 ms.

### 2c. (full) Bypass total de ultralytics — runtime TensorRT propio

- Cargar el `.engine` con `tensorrt.Runtime` directamente.
- Pre-procesado: cv2.cuda o torch (en GPU, no CPU). Idealmente leer el frame a un tensor pinned.
- `context.execute_v2(...)` → tensors crudos.
- Decodificar boxes manualmente (YOLO11 output shape `(1, 84, 8400)` → boxes + classes con NMS).
- ByteTrack manual.
- **Esperado:** baja a ~10–12 ms.
- **Costo:** ~150–250 LOC de código nuevo, mantenimiento, pero portfolio piece real (ver Group 4).

Decidir cuál opción según los datos del Group 1. Si el overhead es 90% wrapper de ultralytics y 10% tracker, 2a probablemente alcanza.

## Group 3: Reducir contention de sistema

Cosas que aplican independientemente del path elegido en Group 2.

1. **Persistir `jetson_clocks` en boot** (ya tenía borrador en la respuesta inicial):
   - Crear `deploy/jetson-clocks.service` con `ExecStart=/usr/bin/jetson_clocks`.
   - `Type=oneshot`, `After=nvpmodel.service`.
   - Habilitar en `deploy/install.sh` cuando `ROBOT_MODE=robot`.
   - Sin esto, cada reboot el robot cae de 19 fps a 10 fps hasta que alguien manualmente pinee.

2. **Pre-resize en el camera-worker (opcional, si pre=5ms se vuelve relevante):**
   - Hoy el camera-worker entrega 1080p al backend, que lo encola al inference-worker, que hace el resize a 640.
   - Si todos los consumidores quieren 640 (TRT inference, no live ni recording), el resize podría hacerse una sola vez en el camera-worker.
   - Pero live y recording quieren 1080p. Habría que tener dos paths o resize on-demand. **Probable que no valga la pena** comparado con eliminar el wrapper overhead. Re-evaluar después de Group 2.

3. **Verificar que no hay JPEG round-trip innecesario:**
   - Backend recibe frame raw del camera-worker, lo encodea a JPEG, lo manda al inference-worker, que decodea.
   - JPEG encode + decode es ~3–5 ms total que no necesitamos: el inference-worker podría leer frames raw del mismo socket de cámara (fan-out ya soportado por el worker).
   - **No bloquea Phase 16**, pero agendar como follow-up.

## Group 4: Writeup / portfolio piece

El trabajo de optimización es solo la mitad del valor. La otra mitad es contar cómo se hizo.

1. **Crear `docs/inference-optimization.md`** (o markdown en este folder) con:
   - Hardware spec.
   - Tabla de resultados ([backend, p50, p90, p99, FPS, mAP]) — al menos 3 filas: PyTorch FP32, TRT FP16 baseline (con `model.track()`), TRT FP16 optimizado.
   - Metodología: cómo medimos, ventana, calentamiento, contention controlada.
   - Análisis: qué encontramos en el profiling y por qué movimos lo que movimos.
   - Decisión: qué opción elegimos del Group 2 y por qué.
   - Resultado: gráfico simple (matplotlib) de p50 y FPS por backend.
   - Tradeoffs descartados: qué cosas no hicimos y por qué (INT8, fused preprocess en GPU, plugin custom).

2. **Validar mAP** sobre el dataset de evaluación de blueberry (si existe; si no, dejar como TODO):
   - Engine FP16 vs PT FP32 → diferencia debería ser <0.5 mAP.
   - Si es >2 mAP, hay un problema en la conversión que vale la pena investigar.

3. **Capturar trace de Nsight Systems** (opcional, pero buen artifact visual):
   - `nsys profile -o /tmp/inference.qdrep --stats=true ...`
   - Screenshot del timeline mostrando dónde se va el tiempo en GPU/CPU.

## Out of scope para Phase 16

- INT8 quantization (Phase futura).
- Custom TensorRT plugin para fusionar decode + NMS en GPU.
- Multi-stream / multi-model serving.
- Migrar a Triton.
- Cambiar el modelo (yolo11n) por algo más chico.

Estos son válidos pero requieren mucho más tiempo. Phase 16 es: hacer que la inferencia que ya tenemos corra a la velocidad que debería.

## Criterios de "done"

- Group 1 produjo un breakdown con todas las componentes sumadas que cuadra con el total medido (no más "gap").
- Inferencia TRT FP16 corre a ≤15 ms p50 (vs 52 ms actual).
- FPS efectivo del worker ≥60 (vs 19 actual).
- Speedup TRT vs PT en el path optimizado es ≥3× (vs 1.44× actual).
- Cambios mergeados sin regresión en mAP (validado contra el dataset de eval).
- Writeup publicado, mínimo cubre tabla + metodología + decisión.
- `jetson_clocks` se ejecuta en boot (no requiere intervención manual post-reboot).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reescribir el inference path rompe tracking | Mantener `model.track()` como fallback detrás de un env var hasta validar el path nuevo |
| Después de bypass del wrapper, mAP cambia | Comparar contra el path antiguo en el mismo set de frames antes de mergear |
| `jetson_clocks` causa overheating en operación real (sin fan adecuado) | Monitorear temps con `tegrastats`; tener opción de fallback al modo dinámico vía env |
| El bottleneck real está fuera de `model.track()` (e.g., socket I/O del backend) | Group 1 incluye instrumentación end-to-end no solo del worker |
