---
name: Resolución 1080p en grabación (con 720p como opción)
description: Subir el default de captura a 3840×1080 estéreo SBS recortado a 1920×1080 (un ojo) para que tanto el live como el MP4 grabado tengan ~2.25× más detalle. Mantener 720p como modo seleccionable vía env vars existentes para casos donde el ancho de banda o el budget de disco lo requieran.
---

# Requirements: Resolución 1080p en grabación

## Scope

Phase 8 dejó la grabación a 1280×720 nítida (8 Mbps, NVENC profile=High preset=Slow, captura YUYV). Esta fase sube el default de captura a 1920×1080 (un ojo del estéreo 3840×1080 que la ZED 2i soporta a 30fps por USB 3.0), preservando 720p como un modo configurable. La arquitectura de fan-out del `camera_worker` no cambia: live (WebRTC + inference) y recording siguen consumiendo el mismo frame.

**Dentro de alcance:**

- Bumpear los defaults de `camera_worker` a `CAMERA_WIDTH=3840 / CAMERA_HEIGHT=1080 / CAMERA_CROP=1920` para que un robot recién deployado capture 1080p de un ojo izquierdo sin tocar nada.
- 720p sigue siendo seleccionable vía las env vars existentes (`CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`) — es un cambio en `.env.robot` y `make restart`.
- El recording-worker auto-elige el bitrate según la altura del frame entrante (12 Mbps si height ≥ 1080, 8 Mbps si menor). Sin nuevas env vars (eso sigue siendo Phase 7).
- Validar que la transmisión live (WebRTC) y la inferencia YOLO no degradan perceptiblemente al subir el frame de 1280×720 a 1920×1080 (2.25× pixels, 2.25× JPEG encode + WebRTC bitrate).
- Documentar en `recording_worker/README.md` y `camera_worker/README.md` los dos modos (1080p default, 720p alternativo) y cuándo elegir cada uno.

**Fuera de alcance:**

- Estéreo full (los dos ojos en el MP4) — sigue requiriendo fan-out por-cliente con resoluciones distintas, fuera de scope.
- 4416×1242 — solo 15 fps en la ZED 2i, degradaría fluidez. Fuera de scope.
- Selección dinámica de resolución por sesión desde la UI (toggle en frontend) — esta fase la hace por config a nivel proceso. UI runtime es fase posterior si la operación lo pide.
- Per-client downscale en el `camera_worker` (live a 720p mientras recording captura 1080p) — solo lo introducimos si la validación demuestra regresión inaceptable en live.
- Audio, overlays, codec H.265 — sin cambios.
- Política de retención de disco — operativa, no de worker. Mencionar el nuevo tamaño aproximado en docs (~90 MB/min a 1080p 12 Mbps), no manejarlo.
- Exponer el bitrate como env var — pertenece a Phase 7.

## Inputs / Data

Sin cambios de schema. Solo defaults y un cálculo derivado:

**Camera worker (`camera_worker/camera_worker/main.py`)**

| Variable | Antes (Phase 8) | Después (Phase 9) | Notes |
|----------|-----------------|-------------------|-------|
| `CAMERA_WIDTH` default | `2560` | `3840` | ZED 2i: 3840×1080 estéreo SBS @30 vía USB 3.0. |
| `CAMERA_HEIGHT` default | `720` | `1080` | |
| `CAMERA_CROP` default | `1280` | `1920` | Mitad izquierda → un ojo a 1920×1080. |
| `CAMERA_FPS` default | `30` | `30` | Sin cambio. |
| `CAP_PROP_FOURCC` | `YUYV` | `YUYV` | Sin cambio (validar bandwidth USB con `lsusb -t`). |

**Recording worker (`recording_worker/recording_worker/encoder.py`)**

| Parámetro | Antes | Después | Razón |
|-----------|-------|---------|-------|
| `GstMp4Encoder.__init__` `bitrate` | `8_000_000` | derivado en `start()` | Hardcoded 8 Mbps no sirve para 1080p. |
| Lógica nueva en `GstMp4Encoder.start` | n/a | `if height >= 1080: bitrate = 12_000_000 else: 8_000_000` | Sweet-spot para cada modo. |
| `PyAvEncoder` libx264 | `6_000_000` | mismo escalado (`9_000_000` para ≥1080p, `6_000_000` para <1080p) | Mantener calidad consistente en dev. |

**Backend WebRTC (`back/services/camera.py:CameraStreamTrack`)**

Sin cambios de código. Pero sí validar con `chrome://webrtc-internals/` que el bitrate WebRTC suba sin fragmentar. `aiortc` no impone topes — la negociación SDP sube sola al detectar más pixels.

**Backend inference cliente (`back/services/perception/inference_client.py`)**

Sin cambios. El JPEG quality 85 sigue igual; solo el tamaño del JPEG por frame crece (~2.25×). Validar que el throughput no caiga.

## Behavior

**Operador (1080p default):**

- En el robot recién instalado, abre la pantalla Vision: ve el video en vivo a 1920×1080 (más detalle que antes, mismo crop estilo "un ojo").
- Inicia grabación: el MP4 resultante es 1920×1080 a ~12 Mbps. Tamaño ~90 MB/min, ~5.4 GB/h. Visualmente, las hojas y frutos chicos se ven con más detalle que en 720p (especialmente en revisión zoomed-in).
- Si la transmisión live se siente con más latencia o lag (raro pero posible en redes débiles entre Jetson y laptop del operador), puede reportarlo y el admin baja a 720p editando `.env.robot`.

**Operador (720p alternativo):**

- Si `.env.robot` define `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`, todo se comporta igual que después de Phase 8: live y MP4 a 1280×720, bitrate auto-elegido a 8 Mbps.
- No hay diferencia funcional para el operador — solo nitidez y tamaño del MP4.

**Camera worker:**

- Al boot loggea `Camera opened (index=…) — actual 3840x1080 @ 30.0fps fourcc=YUYV` (o lo que negoció).
- Si la cámara rechaza 1080p (raro: la ZED 2i lo soporta), cae al closest match de V4L2 y loggea el resultado real. El worker no crashea.
- Sin cambios en el handshake: ya emite `width/height/channels/fps` desde Phase 8.

**Recording worker:**

- Al recibir `start`, lee `width/height` del handshake del camera-worker (ya lo hace) y elige el bitrate antes de armar el pipeline.
- Loggea explícitamente el bitrate usado: `Recording started uuid=… backend=nvv4l2h264enc out=… 1920x1080 @ 30.0fps bitrate=12000000`.

## Decisions

- **1920×1080 single-eye, no estéreo full** — confirmado por el usuario. Mantener "un ojo" preserva el contrato del frame actual (no introduce una segunda dimensión que algunos consumidores no esperan) y evita el fan-out per-client. Si en el futuro la operación necesita los dos ojos para profundidad o crops alternativos, eso es phase aparte.
- **3840×1080 captura, no 2560×720 → upscale** — confirmado por el usuario. Capturar a 1080p nativo de la cámara aprovecha el sensor; un upscale en software nunca recupera detalle perdido. La ZED 2i a 3840×1080 @30 ronda 248 MB/s en YUYV (3840×1080×2 bytes/pixel × 30 fps), bien dentro de los ~600 MB/s útiles de USB 3.0.
- **No 4416×1242** — confirmado por el usuario. Esa resolución solo soporta 15 fps, lo que degradaría la fluidez del live y del MP4. Si se quisiera ese modo en el futuro sería phase aparte y debería discutirse el trade-off explícitamente.
- **720p sigue como opción seleccionable, sin UI** — confirmado por el usuario. La selección se hace via las env vars que ya existen en `camera_worker` desde antes; no agregamos UI runtime ni env nueva. El cambio es: editar `.env.robot`, `make restart`. Lo documentamos en los READMEs.
- **Bitrate auto-escalado por altura, no env var** — Phase 7 cubrirá la env var `RECORDING_BITRATE_BPS`. Aquí solo necesitamos que el bitrate cambie cuando alguien alterna entre los dos modos canónicos (720p ↔ 1080p). Un `if height >= 1080` resuelve eso sin invadir el scope de Phase 7.
- **12 Mbps NVENC para 1080p, no 16 ni 10** — Calibración: 720p funciona bien a 8 Mbps. El target perceptual es similar. 1080p tiene 2.25× pixels pero la compresión H.264 a `profile=High` con CABAC + B-frames captura redundancia espacial — el bitrate no escala lineal con pixels. 12 Mbps queda en el rango típico de streaming 1080p (Netflix, YouTube usan 8-15 Mbps a 1080p) y mantiene el archivo bajo 100 MB/min. Si validation muestra blocky en cultivo denso, subimos a 14; si sobra calidad, bajamos a 10. 12 es punto medio defensible.
- **Live + recording comparten frame, sin per-client downscale** — sí, el WebRTC va a recibir 1920×1080 también. Es una decisión consciente: la arquitectura de fan-out actual reparte el mismo frame a todos los clientes, y meter downscale per-client requiere agregar una cola por consumidor con transformaciones. Si validation demuestra que WebRTC se atraganta o YOLO baja FPS notablemente, abrimos phase aparte para downscale per-client. Hoy no lo justifica nada.
- **JPEG inference no se baja de 85 a algo menor** — el costo extra de JPEG encode a 1920×1080 es real (~2.25× CPU) pero el modelo YOLO redimensiona internamente a su input size (típicamente 640 o 1280). Bajar el JPEG quality afectaría detección de bordes finos. Si JPEG encode resulta ser bottleneck en validation, el fix correcto es saltar JPEG y mandar BGR raw por el socket de inference (refactor mayor) — no degradar la calidad.
- **Documentar el switch a 720p en los dos READMEs** — uno solo no basta porque el operador puede entrar por cualquiera. La nota en `camera_worker/README.md` explica las env vars; la nota en `recording_worker/README.md` explica que el bitrate auto-escala según lo que envíe `camera_worker`. Cross-link entre ambos.

## Context

- See `spec/roadmap.md` — Phase 9: Resolución mayor en grabación.
- See `spec/25-04-26-grabacion-hd/requirements.md` — Phase 8 dejó YUYV + handshake con FPS + NVENC tuned. Todo eso se reusa.
- See `CLAUDE.md` sección "Camera Worker" y "Recording Worker" — workers separados, fan-out, defaults de calidad documentados.
- Existing patterns to follow:
  - Captura V4L2: `camera_worker/camera_worker/main.py:open_camera` (líneas 39-65).
  - Defaults vía env vars: `camera_worker/camera_worker/main.py:parse_args` (`CAMERA_WIDTH`, `CAMERA_HEIGHT`, `CAMERA_CROP`).
  - Pipeline NVENC: `recording_worker/recording_worker/encoder.py:GstMp4Encoder.start` — el bitrate se inyecta vía f-string, basta cambiar de dónde viene `self._bitrate`.
  - Lectura del handshake en el recording-worker: `recording_worker/recording_worker/main.py:CameraReader.connect` (ya parsea `width/height/fps`).
  - Cliente WebRTC del camera socket: `back/services/camera.py:CameraStreamTrack.recv` — convierte frame BGR a `av.VideoFrame`; sin asunciones de tamaño.
- Hardware reference:
  - ZED 2i en `/dev/video0` (Phase 8 corrigió `CAMERA_INDEX` a 0). Modos soportados: 2560×720@30/60, 3840×1080@30, 4416×1242@15.
  - USB 3.0 (5000M) confirmado en este robot vía `lsusb -t` (Phase 8). Headroom suficiente para YUYV 1080p.
  - Jetson Orin NVENC HW handle 1080p sin saturar (NVENC es independiente de CUDA).
