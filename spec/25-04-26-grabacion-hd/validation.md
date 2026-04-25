# Validation: Calidad HD de la grabación

Implementación lista para mergear cuando todas las cajas siguientes pasan.

## Automated Tests

- [ ] `cd recording_worker && uv sync` (laptop) y `uv sync --extra gstreamer` (Jetson) sin errores.
- [ ] `cd recording_worker && uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"` imprime `nvv4l2h264enc` en Jetson, `libx264` en laptop.
- [ ] `cd back && uv run pytest` exits 0 (no se rompe nada existente).
- [ ] `cd front && npx tsc --noEmit` exits 0.
- [ ] `python -c "from recording_worker.recording_worker.encoder import GstMp4Encoder; e = GstMp4Encoder(); assert e._bitrate == 8_000_000"` (sanity check del nuevo default).

### Specific test coverage required

Esta fase no agrega rutas ni schema, así que no requiere tests de unit nuevos. Las verificaciones críticas son manuales (calidad visual + parámetros del archivo).

## Manual Checks

### Configuración del encoder (Jetson)

- [ ] `gst-inspect-1.0 nvv4l2h264enc | grep -E 'preset-level|profile' -A 5` lista `4` como valor válido para preset-level (Slow) y `4` para profile (High).
- [ ] `journalctl -u recording-worker` después de iniciar una grabación muestra el pipeline con `preset-level=4 profile=4 bitrate=8000000`.
- [ ] Iniciar grabación de 30s, parar. `ffprobe -v error -show_streams data/robot/recordings/<uuid>.mp4` reporta:
  - `codec_name=h264`
  - `profile=High`
  - `width=1280`, `height=720`
  - `bit_rate` cercano a 8000000 (±15%)
  - `avg_frame_rate` cercano al FPS real de la cámara (no necesariamente 30)
- [ ] `du -h data/robot/recordings/<uuid>.mp4` ≈ 30 MB para 30 segundos (target: ~60 MB/min).
- [ ] El MP4 abre en VLC sin errores de decoding y se reproduce a velocidad normal (no 2x ni slow-motion).

### Configuración del camera (Jetson)

- [ ] `journalctl -u camera-worker` al arranque muestra: `Camera opened (index=…) — actual 2560x720 @ 30.0fps fourcc=YUYV` (o el FPS real si la cámara no soporta 30).
- [ ] Si la cámara no soporta YUYV, el log muestra el fourcc real (ej. `MJPG`) sin que el worker crashee.
- [ ] El handshake del camera socket incluye `fps`: validable conectando manualmente con `python -c "import socket,struct,json; s=socket.socket(socket.AF_UNIX); s.connect('/tmp/camera.sock'); n=struct.unpack('>I', s.recv(4))[0]; print(json.loads(s.recv(n)))"` → debe imprimir `{'width': 1280, 'height': 720, 'channels': 3, 'fps': 30.0}`.

### Calidad visual (subjetiva pero verificable)

- [ ] Grabar la misma escena (cultivo o un patrón con textura fina como un libro abierto) **antes** del cambio (commit pre-PR) y **después**. Comparar lado a lado:
  - El video nuevo se ve menos blocky en zonas de textura.
  - Los bordes finos (hojas, letras pequeñas) son más definidos.
  - Las transiciones de color (sombras suaves) tienen menos banding.
- [ ] El operador mira el video y dice "se ve mejor" sin tener que comparar con el viejo. (Test informal pero real — la mejora debe ser perceptible sin ayuda.)

### Performance no regresiona

- [ ] Mientras graba: `tegrastats` muestra NVENC en utilización (no idle). El uso CPU del recording-worker se mantiene <20% de un core (la mayor parte del trabajo es en NVENC; videoconvert + nvvidconv corren en CPU/HW).
- [ ] WebRTC live FPS reportado en `VisionPage` no cae más de 1-2 FPS durante grabación simultánea (igual que antes — el cambio es en el encoder, no en el path de cámara).
- [ ] Inferencia YOLO FPS en `VisionPage` se mantiene igual con y sin grabación activa (NVENC y CUDA no compiten).

### Fallback libx264 (laptop dev)

- [ ] `make run-camera` + `make run-recording` en laptop sin GPU NVIDIA: `detect_backend()` cae a `libx264`, grabación de 10s produce un MP4 reproducible.
- [ ] `ffprobe` del MP4 dev muestra `codec_name=h264` y `bit_rate` cercano a 6 Mbps.
- [ ] El uso de CPU del worker durante el encode se mantiene <100% de un core (preset=medium en x264 a 720p en una laptop moderna).

## Post-deploy Checks

- [ ] Tras `make restart` en Jetson: `systemctl status recording-worker.service` → active (running), sin warnings nuevos en `journalctl -u recording-worker`.
- [ ] Sync end-to-end con un server: una grabación nueva (con los parámetros HD) llega al server vía `/recordings`, se descarga y se reproduce con el mismo bitrate/profile que mostró localmente (no hay re-encode en el camino).

## Rollback Criteria

Hacer rollback si: (a) NVENC empieza a saturarse (`tegrastats` muestra NVENC al 100% sostenido y los frames se acumulan en la cola del appsrc, visible como warnings `appsrc push-buffer returned …` en logs), (b) la negociación de YUYV falla en una cámara crítica y el fallback a MJPEG no se da (cámara directamente no abre), o (c) el bitrate de 8 Mbps llena el SSD más rápido de lo operativamente sostenible. Rollback = revert del PR; no requiere migración ni cambio de config.

## Definition of Done

Todas las cajas arriba marcadas, branch rebaseado contra `master` sin conflictos, sin `print` de debug ni TODOs en código nuevo, y la mejora de nitidez confirmada con una comparación lado-a-lado de un MP4 grabado en hardware real (Jetson + ZED) antes y después del PR. El operador valida visualmente que "se ve mejor" sin necesidad de explicación técnica.
