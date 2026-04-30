# Estado actual: latencia de inferencia (post Phase 11)

Documento de baseline. Lo que medimos cuando terminamos de cablear TensorRT, antes de optimizar nada. Sirve para comparar contra cualquier mejora futura.

## Hardware y configuración

- **Plataforma:** Jetson AGX Xavier (32 GB), JetPack 5.x
- **GPU:** Volta 512 cores, max clock 1377 MHz
- **TensorRT:** 8.5.2.2 (sistema, vía `python3-libnvinfer`)
- **PyTorch:** 1.12.0a0 (NVIDIA Jetson wheel)
- **Modelo:** `yolo11n.pt` (Ultralytics 8.4.45), `imgsz=640`
- **Engine:** FP16, construido en Jetson (`yolo11n.<sha256>.fp16.engine`, 6.8 MB)
- **Power mode:** MAXN
- **Clocks:** pineados con `sudo jetson_clocks` (sin esto, GPU bajaba a ~420 MHz / 30% del max)

## Pipeline medido

```
JPEG frame (vía Unix socket desde backend)
  → cv2.imdecode (no medido, fuera del timer)
  → roi crop (numpy slice, "square" mode: 1080×1080 del centro de un frame 1920×1080)
  → model.track(roi, conf=0.5, persist=True)        ← INICIO del timer
      → ultralytics preprocess (resize 1080→640, BGR→RGB, normalize, transpose)
      → inference (PyTorch o TensorRT)
      → NMS (CPU)
      → ByteTrack association + Kalman update
      → Result object construction
                                                    ← FIN del timer
  → mapear bboxes a coordenadas del frame original
  → write_response (JSON sobre socket)
```

El timer cubre el call completo a `model.track()`. Las stages internas las reporta ultralytics en `result.speed`.

## Mediciones (post `jetson_clocks`)

Window: 600 frames (~30s de stream a 30 fps), después de warmup.

### PyTorch (FP32)

```
total p50 = 65.2 ms
total p90 = 70.0 ms
total p99 = 81.1 ms
total mean = 75.1 ms
~13 fps
stages mean: pre=5.0 ms  infer=28.5 ms  post=3.2 ms
```

Sum stages = 36.7 ms. Total = 75.1 ms. **Gap = 38.4 ms** (overhead fuera de las stages reportadas).

### TensorRT FP16

```
total p50 = 51.4 ms
total p90 = 55.9 ms
total p99 = 59.4 ms
total mean = 52.1 ms
~19 fps
stages mean: pre=5.4 ms  infer=16.3 ms  post=3.4 ms
```

Sum stages = 25.1 ms. Total = 52.1 ms. **Gap = 27.0 ms** (overhead fuera de las stages reportadas).

### Comparación

| Metric | PT FP32 | TRT FP16 | Speedup |
|---|---|---|---|
| Preprocess (CPU) | 5.0 ms | 5.4 ms | 0.93× (idéntico, varianza) |
| **Inference** | **28.5 ms** | **16.3 ms** | **1.75×** |
| Postprocess (CPU) | 3.2 ms | 3.4 ms | 0.94× (idéntico) |
| Sum stages | 36.7 ms | 25.1 ms | 1.46× |
| **Total `model.track()`** | **75.1 ms** | **52.1 ms** | **1.44×** |
| FPS efectivo | 13 | 19 | 1.46× |

## Diagnóstico

### Lo bueno

- **TensorRT funciona.** El engine carga, deserializa, y produce detecciones correctas. La inferencia es 1.75× más rápida que PyTorch (28.5 → 16.3 ms).
- **El path E2E está completo.** Toggle UI → conversión async → swap automático → tracker corriendo sobre engine. No hay errores.
- **Clocks pineados eliminaron la mitad del problema** (sin `jetson_clocks` el engine corría a 100 ms / 10 fps porque la GPU oscilaba a 420 MHz).

### Lo problemático

1. **Inference del engine es ~2× más lento de lo esperado.** Para YOLO11n FP16 en Xavier AGX con clocks al máximo, el número de referencia es 6–8 ms con `trtexec`. Estamos en 16.3 ms. La diferencia podría ser:
   - Marshaling Python ↔ TensorRT en cada call (ultralytics convierte tensors).
   - Falta de pinned host memory para la transferencia H2D.
   - Sync síncrono después de cada call (sin streams).
   - Contention con otros workers (camera, recording, backend) por memoria/CPU compartidos en el SoC.

2. **~27 ms de "gap" no contabilizado en las stages.** El timer cubre todo `model.track()`, las stages reportadas suman 25 ms, queda un overhead de 27 ms que ni ultralytics reporta. Hipótesis (en orden de probabilidad):
   - **Per-call Predictor setup.** `model.track()` no es streaming por default. Cada call construye un generator, configura source, instancia callbacks. Eso se nota.
   - **ByteTrack association.** Kalman filter + IoU matrix + Hungarian para cada detección, en Python puro. Para una escena vacía es <1 ms; con detecciones puede crecer.
   - **Result object construction.** Ultralytics ata metadata, names, paths, etc. al objeto Result.
   - **`persist=True` state management.** Mantener IDs estables tiene costo.

3. **Speedup end-to-end es 1.44×, no 4–6× como prometía la teoría.** Porque el modelo (donde TRT acelera) es solo ~38% del tiempo total con el wrapper actual. Aunque hagamos el modelo instantáneo, el techo sigue siendo ~36 ms (preprocess + postprocess + framework overhead).

## Implicancias para el robot

A 19 fps el robot puede contar a velocidad lenta (~0.5 m/s) sin perder objetos en frame, asumiendo que el FOV cubre cada blueberry por al menos ~5 frames. A velocidades más altas o con frutos pequeños, se empieza a perder.

A 30+ fps tendríamos margen para subir la velocidad operativa o agregar un segundo modelo (ej. clasificador de calidad por crop).

## Por qué este problema vale la pena resolver

1. **Para el producto:** abre la velocidad operativa del robot. Si el operador puede pasar 2× más rápido, el día de campo cubre 2× más camellones.

2. **Como ejercicio de inference engineering:** este es exactamente el tipo de problema donde "saber TensorRT por encima" no alcanza — hay que medir, encontrar el bottleneck real, y bajar de capa. Es decir:
   - Medir por etapas (ya hecho).
   - Identificar dónde se va el tiempo (en progreso).
   - Reemplazar el wrapper de alto nivel por código que hace solo lo necesario.
   - Validar que el modelo solo (sin wrapper) corre a la velocidad esperada.
   - Reintroducir tracking sin perder esa velocidad.

   Es contenido de portafolio: tabla de mediciones + análisis + intervención + validación.

## Cómo reproducir las mediciones

```bash
# 1. Pinear clocks (perdida en reboot — ver Phase 16 sobre systemd unit permanente)
sudo jetson_clocks

# 2. Asegurar engine listo
make logs-conversion           # ver que engine_status='ready' para el modelo

# 3. Activar el modelo desde /settings (selecciona la label)
# o vía curl:
curl -sS -X POST http://localhost:8080/api/config/select-label \
  -H 'Content-Type: application/json' \
  -d '{"label":"Persona","model_filename":"yolo11n.pt"}'

# 4. Arrancar el live (envía frames al inference-worker)
# 5. Después de ~30s, leer stats
make bench-inference

# Para comparar con PyTorch: toggle TensorRT off para el modelo desde /settings,
# reseleccionar la label, esperar 30s, repetir bench-inference.
```

El `make bench-inference` retorna un JSON con p50/p90/p99/mean/fps + breakdown por etapa, todo del rolling window de 600 frames del worker.
