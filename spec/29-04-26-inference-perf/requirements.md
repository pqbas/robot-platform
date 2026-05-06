# Requirements: Optimización de latencia de inferencia

## Scope

La inferencia (modelo + tracker + wrapper) corre lo suficientemente rápido para que el robot pueda operar a velocidad de campo realista sin perder detecciones, y para que TensorRT entregue el speedup esperado sobre PyTorch (≥3× end-to-end, no 1.44× como muestra el baseline).

Esta fase **no** cubre: INT8 quantization, plugins custom de TensorRT, migración a Triton, cambio de modelo (yolo11n se mantiene), ni optimización del path de live (WebRTC) o recording.

## Por qué ahora

Phase 11 entregó TensorRT funcionando (toggle UI → conversión → engine swap), pero al medir descubrimos un problema no anticipado: la inferencia total termina siendo solo 1.44× más rápida que PyTorch (52 ms vs 75 ms), cuando la teoría predice 4–6× para YOLO11n FP16 en Xavier AGX. La razón principal es que el wrapper de ultralytics (`model.track()`) agrega ~27 ms de overhead que no aparece en las stages reportadas.

El problema **no estaba en mente** cuando se planeó Phase 11 — era razonable asumir que "activar TensorRT da X velocidad" sin entrar al wrapper. Encontrarlo durante medición es exactamente la razón por la que Phase 16 existe ahora: una vez que tenés la infra, hay que medir, y cuando los números no cuadran con la teoría, hay que bajar de capa.

## Inputs / Data

- Engine TensorRT (`yolo11n.<sha256>.fp16.engine`) ya construido y validado por Phase 11.
- Camera worker entregando frames a 30 fps (1080p).
- Backend forwardeando frames al inference-worker via Unix socket.
- Eval dataset (si existe) para validar mAP no regresiona.

## Comportamiento esperado

### Para el operador

- Sin cambios visibles en la UI ni el flujo. El toggle TensorRT/PyTorch sigue funcionando como en Phase 11.
- El robot puede operar a velocidad ~2× la actual sin perder detecciones (efecto del FPS más alto).

### Para el desarrollador

- `make bench-inference` retorna stats por etapa (preprocess / inference / postprocess) **y** sub-etapas del wrapper (predict, tracker, result construction, roi).
- El número total de `model.track()` (o su reemplazo) cuadra con la suma de las sub-etapas — sin gaps "no contabilizados".
- `jetson_clocks` se aplica automáticamente en boot del robot.
- Existe un writeup que documenta hardware, mediciones, decisiones, y resultado final.

## Métricas / criterios de éxito

| Métrica | Baseline | Target |
|---|---|---|
| Inferencia total (p50) | 52 ms | ≤15 ms |
| FPS efectivo del worker | 19 | ≥60 |
| Speedup TRT vs PT (end-to-end) | 1.44× | ≥3× |
| Inferencia pura del modelo (engine) | 16.3 ms | ~6–8 ms |
| Gap no contabilizado en breakdown | 27 ms | <2 ms |
| mAP@50 (engine vs PT) | TBD | diff <0.5 |

## Out of scope

- INT8 quantization
- Custom TRT plugins (decode + NMS fusion)
- Multi-stream batching
- Triton Inference Server
- Cambiar el modelo (yolo11n se mantiene; sub-modelos por tarea es Phase 14+)
- Optimizar JPEG encode/decode (opcional follow-up)

## Constraints

- El protocolo Unix socket del inference-worker no cambia (header JSON length-prefixed + JPEG).
- El formato de respuesta (detections + tracking_data + count + roi) no cambia.
- El robot debe seguir corriendo en JetPack 5 (TensorRT 8.5.x); no asumimos un upgrade de JetPack en esta fase.
- La conversión sigue ocurriendo en el robot (Phase 11), no se externaliza.

## Por qué esto importa más allá del producto

Esta fase es también material de portafolio. Resolver bien el problema implica:

1. Medir end-to-end con metodología defendible (rolling window, warmup, ventana fija, control de contention).
2. Identificar el bottleneck real (no el sospechado).
3. Bajar de capa de abstracción cuando los datos lo justifican (ultralytics → predictor directo → runtime TRT).
4. Validar que la optimización no degrada accuracy (mAP).
5. Escribir el writeup como artifact reproducible.

Eso es la diferencia entre "integré TensorRT" y "medí, encontré, optimicé, validé". Phase 11 es lo primero; Phase 16 es lo segundo.

## Riesgos conocidos

- **Bypass del wrapper de ultralytics rompe sutilezas del tracker.** Mantener path antiguo detrás de env var hasta validar.
- **mAP cambia silenciosamente** después del refactor. Comparar contra path antiguo en mismo set de frames antes de mergear.
- **`jetson_clocks` permanente sobrecarga térmicamente** en operación de campo prolongada. Monitorear temps; tener fallback dinámico vía env.
