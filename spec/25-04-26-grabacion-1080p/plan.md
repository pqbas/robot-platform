# Plan: Resolución 1080p en grabación

## Group 1: Camera worker — defaults a 1080p

1. En `camera_worker/camera_worker/main.py:parse_args`, subir los defaults:
   ```python
   parser.add_argument("--width",  type=int, default=int(os.getenv("CAMERA_WIDTH",  "3840")))
   parser.add_argument("--height", type=int, default=int(os.getenv("CAMERA_HEIGHT", "1080")))
   parser.add_argument("--crop",   type=int, default=int(os.getenv("CAMERA_CROP",   "1920")))
   ```
   FPS y FOURCC siguen igual (Phase 8 ya los configuró).

2. Verificar manualmente en el Jetson que la cámara realmente negocie 1080p:
   ```bash
   v4l2-ctl --device=/dev/video0 --list-formats-ext | grep -A20 YUYV
   ```
   Debería listar `Size: Discrete 3840x1080` con `Interval: Discrete 0.033s (30.000 fps)`. Si no aparece, abortar Group 1 y reportar — el plan asume soporte hardware.

3. No cambiar `open_camera` ni `_produce` — la lógica de open/reconnect de Phase 8 ya maneja resoluciones genéricas (no hay nada hardcodeado a 720). Confirmar con grep:
   ```bash
   grep -n "720\|1280\b" camera_worker/camera_worker/main.py
   ```
   Solo deberían aparecer en argparse defaults (que ya cambiamos en paso 1) y en strings de logs/comentarios — ningún flujo de control.

---

## Group 2: Recording worker — bitrate por altura

4. En `recording_worker/recording_worker/encoder.py`, agregar un helper module-level para elegir bitrate según altura del frame:
   ```python
   def _bitrate_for_height(height: int, hw_accelerated: bool) -> int:
       """Auto-elige el bitrate H.264 según la altura del frame.

       720p y 1080p son los dos modos canónicos del camera_worker. NVENC
       comprime mejor que libx264 a igual percepción → bitrate menor.
       """
       if height >= 1080:
           return 12_000_000 if hw_accelerated else 9_000_000
       return 8_000_000 if hw_accelerated else 6_000_000
   ```
   Colocarlo justo encima de `class GstMp4Encoder` (después de `detect_backend`).

5. En `GstMp4Encoder.__init__`, quitar el bitrate hardcoded del constructor (o dejarlo como override opcional):
   ```python
   def __init__(self, bitrate: Optional[int] = None) -> None:
       self._bitrate_override = bitrate
       self._bitrate = 0  # se calcula en start() según height
       ...
   ```

6. En `GstMp4Encoder.start`, calcular el bitrate antes de armar el pipeline string:
   ```python
   self._bitrate = self._bitrate_override or _bitrate_for_height(height, hw_accelerated=True)
   logger.info(
       "GStreamer encoder — %dx%d @ %.1ffps bitrate=%d (auto)",
       width, height, fps, self._bitrate,
   )
   ```
   El f-string del pipeline ya inyecta `bitrate={self._bitrate}` — sin más cambios.

7. Repetir el patrón en `PyAvEncoder.__init__` y `PyAvEncoder.start`:
   ```python
   def __init__(self, codec: str, bitrate: Optional[int] = None) -> None:
       self._bitrate_override = bitrate
       self._bitrate = 0
       ...

   # en start():
   self._bitrate = self._bitrate_override or _bitrate_for_height(height, hw_accelerated=False)
   self._stream.bit_rate = self._bitrate
   ```

8. En `make_encoder` no cambiar nada — sigue construyendo el encoder sin pasar bitrate explícito; el cálculo se hace en `start()` cuando ya conocemos el height.

---

## Group 3: Recording worker main — log explícito del bitrate

9. En `recording_worker/recording_worker/main.py:cmd_start`, ya existe el log "Recording started" desde Phase 8. Confirmar que después de `encoder.start(...)` aparezca implicitamente el log del Group 2 paso 6 (que sí dice el bitrate). No requiere cambio en `main.py` — el log nuevo de `encoder.py` cubre el requisito.

---

## Group 4: Validar live + inference no regresan

10. Sin cambios de código en `back/services/camera.py:CameraStreamTrack` ni en `back/services/perception/inference_client.py`. La verificación es de validación (ver `validation.md`):
    - `chrome://webrtc-internals/` mientras transmite live a 1080p — bitrate WebRTC se acomoda solo, validar que `frameWidth/frameHeight` muestre 1920×1080 y FPS ≥ 25.
    - `tegrastats` durante grabación + live — NVENC + CUDA cada uno por su lado, ningún picos a 100% sostenido.
    - YOLO FPS reportado en VisionPage — comparar antes/después; tolerable hasta -2 FPS, más es regresión.

---

## Group 5: Documentación

11. Actualizar `camera_worker/README.md` (crear si no existe — verificar primero con `ls camera_worker/README.md`):
    - Sección "Resolution modes" con dos bloques:
      - **1080p (default)**: `CAMERA_WIDTH=3840 CAMERA_HEIGHT=1080 CAMERA_CROP=1920` — captura nativa del estéreo, crop al ojo izquierdo.
      - **720p (alternativo)**: `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280` — para casos con USB débil o budget de disco apretado.
    - Mencionar el ancho de banda aproximado de cada modo en YUYV (~110 MB/s a 720p, ~250 MB/s a 1080p) para que el operador entienda cuándo hace falta cambiar.

12. Actualizar `recording_worker/README.md` sección "Quality":
    - Agregar bullet sobre el bitrate auto-escalado:
      > El recording-worker lee la altura del frame del handshake del camera-worker
      > y elige el bitrate automáticamente: **12 Mbps** si height ≥ 1080, **8 Mbps**
      > si menor (libx264 fallback usa 9/6 Mbps respectivamente). Para forzar otro
      > bitrate, ver Phase 7 (env var `RECORDING_BITRATE_BPS`, pendiente).
    - Cross-link a `camera_worker/README.md` para los modos de resolución.

13. Actualizar `CLAUDE.md` sección "Camera Worker":
    - Cambiar el default mencionado a 3840×1080 → un ojo a 1920×1080.
    - Agregar línea: "Para volver a 720p: `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280` en `.env.robot` y `make restart`."

14. Actualizar `CLAUDE.md` sección "Recording Worker":
    - Cambiar la línea de defaults a: "NVENC bitrate auto-escalado (12 Mbps a 1080p, 8 Mbps a 720p), profile=High preset=Slow; libx264 9/6 Mbps preset=medium crf=20."

---

## Group 6: Validación manual en hardware (no es código pero es trabajo del PR)

15. Smoke test en Jetson modo 1080p (default nuevo):
    - `make restart`, abrir VisionPage en una laptop conectada a la red local, verificar live a 1920×1080 fluido.
    - Iniciar grabación 30s, parar. `ffprobe data/robot/recordings/<uuid>.mp4` reporta `width=1920 height=1080 bit_rate≈12000000 profile=High`.
    - Tamaño del archivo: ~45 MB para 30s (target ~90 MB/min).
    - Mientras graba: `tegrastats` muestra NVENC en uso, CPU del recording-worker <30% de un core, CUDA disponible para YOLO.

16. Smoke test en Jetson modo 720p (regresión):
    - Editar `.env.robot` con `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`, `make restart`.
    - Grabar 30s, `ffprobe` debe reportar `width=1280 height=720 bit_rate≈8000000` — el bitrate cae solo gracias al auto-escalado.
    - Volver a 1080p (revertir env vars + restart) confirmando que el switch funciona en ambas direcciones.

17. Smoke test en laptop dev (libx264 1080p):
    - Si la laptop tiene cámara que entrega 1080p, validar el path libx264 con auto-bitrate (esperar 9 Mbps).
    - Si no, basta validar el código: `python -c "from recording_worker.recording_worker.encoder import _bitrate_for_height; assert _bitrate_for_height(1080, False) == 9_000_000; assert _bitrate_for_height(720, False) == 6_000_000; assert _bitrate_for_height(1080, True) == 12_000_000; assert _bitrate_for_height(720, True) == 8_000_000"`.

18. Sanity test de live durante grabación 1080p:
    - WebRTC + recording corriendo simultáneo a 1920×1080. El stream live no debe mostrar drops nuevos comparado con 720p. YOLO FPS reportado en VisionPage no cae más de 2 FPS.
    - Si el live regresa más que eso, no hacer merge — abrir issue para per-client downscale como follow-up.
