---
name: Calidad HD de la grabación
description: El MP4 grabado por el robot se ve nítido y aprovecha NVENC con bitrate / profile / preset afinados, sin tocar la arquitectura de fan-out ni la resolución del stream live.
---

# Requirements: Calidad HD de la grabación

## Scope

El MP4 que el `recording-worker` produce hoy es funcional pero se ve borroso/blocky para revisión posterior (4 Mbps a 720p con profile Baseline + preset UltraFast). Esta fase sube la nitidez perceptual del archivo grabado afinando los parámetros del encoder NVENC (`nvv4l2h264enc`) y limpiando la fuente de captura (formato V4L2), sin cambiar la resolución del recording (sigue 1280×720 como el stream live) ni la arquitectura de fan-out de `camera_worker`.

**Dentro de alcance:**

- Subir bitrate del path GStreamer/NVENC a un valor adecuado para 720p detallado (cultivo, frutos chicos).
- Subir profile a `High` y preset a una calidad mayor (`Slow` o equivalente) para mejor compresión a igual bitrate.
- Forzar formato de captura V4L2 a YUYV (uncompressed) para que el encoder reciba pixels sin artefactos previos de MJPEG.
- Setear FPS explícito en `cv2.VideoCapture` y comunicarlo en el handshake del camera socket para que el encoder use el FPS real, no un 30 hardcoded.
- Misma calidad/parámetros aplicados al fallback `libx264` en la medida en que tenga sentido (preset, CRF), para que dev en laptop también vea video legible.

**Fuera de alcance:**

- Grabar a 2560×720 nativo del estéreo (los dos ojos) — eso requiere fan-out por-cliente con resoluciones distintas, es un refactor mayor y queda para una fase posterior.
- Exponer estos parámetros como env vars configurables — eso es Phase 7 (configurabilidad), una fase aparte y posterior. Aquí los hardcodeamos en valores afinados y los documentamos.
- Audio (no aplicable al caso de uso).
- Overlays / annotations quemadas en el MP4 (raw video sigue siendo el contrato).
- Cambio de codec (H.265/HEVC). H.264 sigue siendo lo más compatible para reproducción en clientes simples.
- Política de retención del disco (la sube nivel de uso → es responsabilidad operativa, fuera del worker).

## Inputs / Data

Sin cambios de schema. Todos los ajustes son parámetros del pipeline de encoding y del handshake de cámara:

**Camera worker (`camera_worker/main.py`)**

| Variable | Antes | Después | Notes |
|----------|-------|---------|-------|
| `CAP_PROP_FOURCC` | (no seteado, default MJPEG en muchas cámaras) | `YUYV` | Reduce artefactos de fuente. |
| `CAP_PROP_FPS` | (no seteado) | 30 | Negociado vía V4L2; si la cámara no soporta cae al closest. |
| Handshake JSON | `{width, height, channels}` | `{width, height, channels, fps}` | El recording-worker usa este FPS en lugar de hardcodear 30. |

**Recording worker (`recording_worker/encoder.py:GstMp4Encoder`)**

| Parámetro | Antes | Después | Razón |
|-----------|-------|---------|-------|
| `bitrate` | 4_000_000 (4 Mbps) | 8_000_000 (8 Mbps) | Nitidez perceptual a 720p. ~60 MB/min — manejable en SSD. |
| `preset-level` | 1 (UltraFast) | 4 (Slow) | Mejor decisión de motion estimation a igual bitrate. NVENC HW: el costo es marginal en Jetson. |
| `profile` | 0 (Baseline) | 4 (High) | Mejor compresión + soporta CABAC y B-frames. Compatible con todos los players modernos. |
| `control-rate` | 1 (CBR) | 1 (CBR) | Sin cambio: predecible para budget de disco. |
| `iframeinterval` | 60 (2s @30) | 60 | Sin cambio. |

**Recording worker fallback (`PyAvEncoder` libx264)**

| Parámetro | Antes | Después | Razón |
|-----------|-------|---------|-------|
| `bit_rate` | 4_000_000 | 6_000_000 | CPU x264 es menos eficiente que NVENC; subir un poco para acercar calidad. |
| `preset` | `veryfast` | `medium` | Cae el FPS efectivo en CPU pero dev solo graba pruebas cortas. |
| `tune` | `zerolatency` | (quitar) | `zerolatency` desactiva B-frames y baja eficiencia; no necesario fuera de live streaming. |

## Behavior

**Operador (no nota cambio funcional, solo visual):**

- Inicia y detiene grabación igual que antes.
- El MP4 resultante muestra detalles (hojas, frutos chicos, texturas) más definidos a igual duración. El tamaño del archivo aproximadamente duplica (de ~30 MB/min a ~60 MB/min en Jetson).
- El log al detener (`Recording stopped: …`) sigue reportando `width`, `height`, `fps`. El `fps` ahora refleja el real (30 ± 2) en vez de calcular contra un asumido.

**Recording worker:**

- Al recibir `start`, lee `fps` del handshake del camera socket (no hardcodea 30) y lo pasa al encoder.
- Si la cámara entrega un FPS distinto (p.ej. 15 en USB 2.0), el `framerate` del pipeline GStreamer y el `rate` de PyAV se ajustan automáticamente. Playback queda a velocidad real.

**Camera worker:**

- Loggea al abrir cámara: `Camera opened (index=…) — actual resolution 2560x720 @ 30fps fourcc=YUYV` (o el que negoció).
- Si YUYV no se acepta, fallback silencioso a lo que la cámara dé y log explícito (`fourcc negotiated: MJPG`). No falla el worker.

## Decisions

- **Mantener resolución 1280×720** — el operador respondió (1a). Subir a 2560×720 nativo requeriría fan-out por-cliente con resoluciones distintas (stream live cropped vs recording full), refactor mayor que sale de scope. La nitidez en este phase viene de bitrate/profile/preset, no de pixeles extra.
- **Bitrate 8 Mbps en NVENC, no 6 ni 10** — Sweet spot para 720p detallado en NVENC. Por debajo de 6 Mbps el blocky reaparece en escenas con texturas finas (hojas); por encima de 10 Mbps el archivo crece sin ganancia visible (NVENC ya está bien afinado a 720p en ese rango). 8 Mbps = ~60 MB/min, ~3.6 GB/h, manejable en el SSD de 327 GB.
- **Profile High + preset Slow en NVENC** — el costo en Jetson Orin con HW encoder es marginal (NVENC es HW dedicated, no compite con CUDA/CPU). El profile High habilita CABAC y predicción más sofisticada → mejor calidad a igual bitrate. Preset Slow le da al encoder más tiempo para decidir motion vectors. Si más adelante notamos drops de FPS por NVENC saturado, bajamos a preset 3 (Medium); por ahora 4 es seguro.
- **Forzar YUYV en V4L2 en scope** — Muchas cámaras USB (incluida la ZED 2i en algunos modos) entregan MJPEG por defecto. MJPEG es lossy; reencodear a H.264 perpetúa artefactos. YUYV es uncompressed (~3x USB bandwidth) pero da fuente limpia al encoder. La ZED 2i a 2560×720 @30 ronda los 110 MB/s — cabe en USB 3.0 sin problema (5 Gbps = ~600 MB/s útiles). Si por alguna razón YUYV falla, log y caemos al default sin crashear.
- **FPS explícito + handshake** — el worker hoy hardcodea 30 (`recording_worker/recording_worker/main.py:191 fps = 30.0`). Ese commit ya fue mitigado parcialmente con `do-timestamp=true`, pero el `framerate=30/1` en el caps del appsrc sigue mintiendo si el real es otro. Pasar el FPS real desde el camera_worker mata el bug de raíz y ayuda a diagnosticar (FPS reportado es real, no asumido).
- **Sin H.265 / HEVC** — la ganancia de eficiencia (~30%) no compensa el costo de menor compatibilidad y más complejidad de pruebas en este momento. Re-evaluar si el budget de disco pesa.
- **Sin tocar el WebRTC live** — el stream live ya funciona y este phase no apunta a cambiar lo que ve el operador en tiempo real, solo lo que se guarda en disco. Cambiar el live es scope independiente.
- **libx264 fallback recibe ajustes proporcionales** — para que dev en laptop también vea video legible. Pero no obsesionarse: el fallback es para pruebas locales, no para producción.

## Context

- See `spec/roadmap.md` — Phase 8: Calidad HD de la grabación.
- See `spec/25-04-26-grabacion-video/requirements.md` — la fase anterior que entregó el MP4 funcional pero a 4 Mbps Baseline UltraFast.
- See `CLAUDE.md` — workers separados; el backend no toca encoders.
- Existing patterns to follow:
  - Pipeline GStreamer NVENC: `recording_worker/recording_worker/encoder.py:GstMp4Encoder.start` (líneas 115-160 post-fix).
  - Captura V4L2 + handshake: `camera_worker/camera_worker/main.py:open_camera` y `handle_client` (handshake JSON).
  - Cliente del camera socket en el recording-worker: `recording_worker/recording_worker/main.py:CameraReader.connect` (parsea handshake).
  - Detección y selección de backend: `recording_worker/recording_worker/encoder.py:detect_backend`.
- Documentación NVIDIA del encoder: `gst-inspect-1.0 nvv4l2h264enc` en Jetson lista todos los profiles/presets disponibles (correr en hardware antes de afinar).
