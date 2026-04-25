# Validation: Resolución 1080p en grabación

Implementación lista para mergear cuando todas las cajas siguientes pasan.

## Automated Tests

- [ ] `cd recording_worker && uv sync` (laptop) y `uv sync --extra gstreamer` (Jetson) sin errores.
- [ ] `cd back && uv run pytest` exits 0 (sin regresión).
- [ ] `cd front && npx tsc --noEmit` exits 0.
- [ ] Sanity check del helper de bitrate:
  ```bash
  cd recording_worker && uv run python -c "
  from recording_worker.encoder import _bitrate_for_height
  assert _bitrate_for_height(1080, hw_accelerated=True)  == 12_000_000
  assert _bitrate_for_height(1080, hw_accelerated=False) ==  9_000_000
  assert _bitrate_for_height(720,  hw_accelerated=True)  ==  8_000_000
  assert _bitrate_for_height(720,  hw_accelerated=False) ==  6_000_000
  assert _bitrate_for_height(1242, hw_accelerated=True)  == 12_000_000
  print('ok')"
  ```
- [ ] `cd recording_worker && uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"` imprime `nvv4l2h264enc` en Jetson, `libx264` en laptop.

### Specific test coverage required

Esta fase no agrega rutas ni schema. La única función nueva pura (`_bitrate_for_height`) queda cubierta por el sanity check de arriba; no requiere archivo de tests dedicado. Las verificaciones críticas son manuales (calidad visual, perf de live + grabación).

## Manual Checks

### Modo 1080p (default nuevo) — Jetson

- [ ] `v4l2-ctl --device=/dev/video0 --list-formats-ext | grep -A20 YUYV` lista `Discrete 3840x1080` con `Interval: Discrete 0.033s (30.000 fps)`. Si no, abortar — el hardware no soporta el modo asumido.
- [ ] `journalctl -u camera-worker` post-`make restart` muestra `Camera opened (index=0) — actual 3840x1080 @ 30.0fps fourcc=YUYV` (FPS real puede ser 29.x — aceptable).
- [ ] `lsusb -t` muestra la cámara en SuperSpeed (`5000M`), no `480M`. Si está en USB 2.0, abortar — bandwidth insuficiente para YUYV 1080p.
- [ ] Conectar al camera socket manualmente y validar el handshake:
  ```bash
  python -c "import socket,struct,json; s=socket.socket(socket.AF_UNIX); s.connect('/tmp/camera.sock'); n=struct.unpack('>I', s.recv(4))[0]; print(json.loads(s.recv(n)))"
  ```
  Debe imprimir `{'width': 1920, 'height': 1080, 'channels': 3, 'fps': 30.0}`.
- [ ] Iniciar grabación 30s desde la UI, parar. `ffprobe -v error -show_streams data/robot/recordings/<uuid>.mp4` reporta:
  - `codec_name=h264`
  - `profile=High`
  - `width=1920`, `height=1080`
  - `bit_rate` cercano a 12000000 (±15%)
  - `avg_frame_rate` cercano a 30
- [ ] `du -h data/robot/recordings/<uuid>.mp4` ≈ 45 MB para 30s (target ~90 MB/min, ~5.4 GB/h).
- [ ] `journalctl -u recording-worker` muestra el log nuevo: `GStreamer encoder — 1920x1080 @ 30.0fps bitrate=12000000 (auto)`.
- [ ] El MP4 abre en VLC sin errores y reproduce a velocidad normal (no slow-motion ni 2x).

### Modo 720p (alternativo) — Jetson

- [ ] Editar `.env.robot` con `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`, `make restart`.
- [ ] `journalctl -u camera-worker` muestra `Camera opened (index=0) — actual 2560x720 @ 30.0fps fourcc=YUYV`.
- [ ] Handshake del camera socket: `{'width': 1280, 'height': 720, 'channels': 3, 'fps': 30.0}`.
- [ ] Grabación 30s: `ffprobe` reporta `width=1280 height=720 bit_rate≈8000000`. El log del recording-worker muestra `bitrate=8000000 (auto)`.
- [ ] Revertir env vars (volver a 1080p), `make restart`, validar que el switch sea bidireccional sin regresión.

### Performance no regresiona durante grabación 1080p

- [ ] WebRTC live a 1920×1080: en `chrome://webrtc-internals/` el peer connection muestra `frameWidth=1920, frameHeight=1080` y `framesPerSecond ≥ 25`.
- [ ] YOLO FPS reportado en `VisionPage` (overlay de detecciones) no cae más de 2 FPS comparado con la operación a 720p (medir en la misma escena: con grabación off vs on).
- [ ] `tegrastats` durante grabación + live simultáneos:
  - NVENC en uso (no idle) pero no 100% sostenido.
  - CUDA disponible para YOLO (no contención visible).
  - CPU del recording-worker <30% de un core.
  - CPU del backend (FastAPI + JPEG encode) <60% de un core (subió de ~30% a 720p, aceptable; si pasa de 80% es regresión).
- [ ] La latencia visual del live (gesto frente a la cámara → aparición en pantalla) no aumenta perceptiblemente vs 720p. Si el operador nota lag adicional, no mergear.

### Calidad visual (subjetiva pero verificable)

- [ ] Grabar la misma escena (cultivo o un libro abierto con texto pequeño) en 720p (commit pre-PR de Phase 8) y en 1080p (este PR). Comparar lado a lado:
  - El video 1080p muestra detalles finos (vetas de hojas, texto pequeño, bordes de fruta) que en 720p se pierden o se ven blocky.
  - No hay artefactos nuevos (ringing, banding, bloqueos en zonas estáticas) — si aparecen, el bitrate de 12 Mbps puede ser insuficiente, considerar 14 Mbps.
- [ ] El operador mira el video 1080p sin comparación previa y confirma que "se ve mejor". (Test informal pero real — la mejora debe ser perceptible sin ayuda.)

### Fallback libx264 (laptop dev)

- [ ] Si la cámara dev soporta 1080p: `make run-camera` con env vars 1080p + `make run-recording`, grabar 10s. `ffprobe` reporta `width=1920 height=1080 bit_rate≈9000000 codec_name=h264`.
- [ ] Uso de CPU del worker durante encode 1080p libx264 <200% de un core (preset=medium en x264 a 1080p en laptop moderna; si pasa de 300% revisar si el preset debería bajar a `fast` para dev).
- [ ] Si la cámara dev no soporta 1080p: confirmar que el path 720p sigue funcionando con `bit_rate≈6000000` (regresión cero del modo previo).

## Post-deploy Checks

- [ ] Tras `make restart` en Jetson con defaults nuevos: `systemctl status camera-worker recording-worker` → ambos active (running), sin warnings nuevos en `journalctl`.
- [ ] Sync end-to-end: una grabación 1080p nueva llega al server vía `/recordings`, se descarga y `ffprobe` muestra los mismos 1920×1080 / 12 Mbps / High (no hay re-encode en el camino).
- [ ] El admin puede revisar visualmente que el detalle del MP4 en server es el mismo que en robot (zoom-in al mismo frame).

## Rollback Criteria

Hacer rollback si:
- (a) `tegrastats` muestra NVENC al 100% sostenido durante grabación, con `appsrc push-buffer returned …` warnings en logs (frames acumulándose en cola).
- (b) WebRTC live cae perceptiblemente (FPS < 20, latencia > 1s) y el operador reporta que no es usable.
- (c) YOLO FPS cae más de 5 FPS por contención de bus de memoria entre JPEG encode y CUDA.
- (d) USB 3.0 no entrega 1080p YUYV de forma estable (frames truncados, errores V4L2 en `dmesg`).

Rollback rápido sin revert: editar `.env.robot` con las env vars de 720p y `make restart`. El código nuevo soporta ambos modos; volver a 720p es operativo, no requiere revertir el PR.

Rollback completo (revert del PR) solo si el modo 720p también regresa por algún side effect del cambio en `encoder.py` — improbable porque el helper de bitrate es aditivo.

## Definition of Done

Todas las cajas arriba marcadas, branch rebaseado contra `master` sin conflictos, sin `print` de debug ni TODOs nuevos. La nitidez del 1080p confirmada con comparación lado a lado de un MP4 grabado en hardware real (Jetson + ZED 2i) frente al MP4 720p de Phase 8. El operador valida visualmente que "se ve mejor" sin necesidad de explicación técnica, y el switch a 720p sigue funcionando vía env vars como red de seguridad documentada.
