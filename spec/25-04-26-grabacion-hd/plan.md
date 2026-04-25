# Plan: Calidad HD de la grabación

## Group 1: Camera worker — formato V4L2 limpio + FPS en handshake

1. En `camera_worker/camera_worker/main.py:open_camera` (líneas 38-54), forzar fourcc y FPS antes del check de `cap.isOpened()`:
   ```python
   cap = cv2.VideoCapture(args.index)
   cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"YUYV"))
   cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
   cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
   cap.set(cv2.CAP_PROP_FPS, args.fps)
   cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
   ```
   Después de `isOpened()`, leer y loggear lo que la cámara realmente negoció:
   ```python
   actual_fps = cap.get(cv2.CAP_PROP_FPS)
   actual_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
   fourcc_str = "".join(chr((actual_fourcc >> 8 * i) & 0xFF) for i in range(4))
   logger.info("Camera opened (index=%d) — actual %dx%d @ %.1ffps fourcc=%s",
               args.index, actual_width, actual_height, actual_fps, fourcc_str)
   ```
   Devolver `actual_fps` también desde `open_camera` para propagarlo al broadcaster.

2. Añadir flag `--fps` en `parse_args` (con env var `CAMERA_FPS`, default 30).

3. En `FrameBroadcaster`, guardar `_actual_fps` (lo que devolvió `open_camera`). Exponerlo como `out_fps` propiedad.

4. En `handle_client`, agregar el FPS al handshake JSON:
   ```python
   handshake = json.dumps({
       "width": broadcaster.out_width,
       "height": broadcaster.out_height,
       "channels": 3,
       "fps": broadcaster.out_fps,
   }).encode()
   ```

5. En `_produce`, después de un reconnect tras desconexión de cámara, refrescar `_actual_fps` desde el nuevo `open_camera`. (Los clientes ya conectados ven el handshake viejo — aceptable; en una desconexión + reconexión grave el operador puede reiniciar el recording si el FPS cambió drásticamente.)

---

## Group 2: Recording worker — leer FPS del handshake

6. En `recording_worker/recording_worker/main.py:CameraReader.connect`, parsear el campo opcional `fps` del handshake (con default 30 para compatibilidad si el camera_worker es viejo):
   ```python
   self.fps = float(handshake.get("fps") or 30.0)
   ```
   Añadir `self.fps: float = 30.0` en `__init__` para tipo coherente.

7. En `recording_worker/recording_worker/main.py:cmd_start`, reemplazar el hardcode `fps = 30.0` (línea actual ~191) por `fps = reader.fps` después del `reader.connect()`. Loguear el FPS al iniciar:
   ```python
   logger.info("Recording started uuid=%s backend=%s out=%s %dx%d @ %.1ffps",
               uuid, encoder.backend, output_path, reader.width, reader.height, fps)
   ```

---

## Group 3: Recording worker — encoder NVENC afinado (Jetson)

8. En `recording_worker/recording_worker/encoder.py:GstMp4Encoder.__init__`, subir el bitrate default:
   ```python
   def __init__(self, bitrate: int = 8_000_000) -> None:
   ```

9. En `GstMp4Encoder.start`, ajustar parámetros del elemento `nvv4l2h264enc` en el pipeline:
   - `preset-level=4` (Slow, antes 1)
   - `profile=4` (High, antes 0 = Baseline)
   - `control-rate=1` (CBR, sin cambio)
   - `iframeinterval=60` (sin cambio)

   El string del pipeline queda:
   ```
   ! nvv4l2h264enc bitrate={self._bitrate} preset-level=4 profile=4 control-rate=1 iframeinterval=60
   ```
   Mantener `nvvidconv` y `do-timestamp=true` que ya están post-fix.

10. Validar que `preset-level=4` y `profile=4` existen en el `nvv4l2h264enc` instalado:
    - Ejecutar `gst-inspect-1.0 nvv4l2h264enc | grep -A2 preset-level` y `... profile` en el Jetson de prueba.
    - Documentar el output en un comentario corto sobre el bloque del pipeline (qué número significa qué) para que la próxima vez no haya que re-googlearlo.

---

## Group 4: Recording worker — fallback libx264 (laptop dev)

11. En `recording_worker/recording_worker/encoder.py:PyAvEncoder.__init__`, subir el bitrate default:
    ```python
    def __init__(self, codec: str, bitrate: int = 6_000_000) -> None:
    ```

12. En `PyAvEncoder.start`, cambiar las options de libx264:
    ```python
    if self._codec == "libx264":
        self._stream.options = {"preset": "medium", "crf": "20"}
    ```
    (Quitar `tune: zerolatency`. Optar por CRF 20 para calidad consistente independiente de bitrate; mantener `bit_rate` como ceiling — PyAV pasa ambos a x264, CRF gana cuando hay slack.)

---

## Group 5: Documentación

13. Actualizar `recording_worker/README.md`:
    - Sección nueva "Calidad" describiendo los parámetros actuales y por qué (un párrafo por backend).
    - Añadir el comando para inspeccionar el encoder en Jetson (`gst-inspect-1.0 nvv4l2h264enc`).
    - Mencionar que el FPS se toma del handshake del camera-worker, no se hardcodea.

14. Actualizar `CLAUDE.md` (sección "Recording Worker"):
    - Una línea sobre los defaults de calidad nuevos (8 Mbps NVENC, 6 Mbps libx264).
    - Mencionar que cualquier cambio futuro a esos parámetros debería ir junto al ticket de Phase 7 (configurabilidad por env var).

---

## Group 6: Validación manual (no es código pero es trabajo del PR)

15. Smoke test en Jetson:
    - `make restart`, iniciar grabación 30s, abrir el MP4 en VLC.
    - Comparar visualmente vs un MP4 viejo de la rama `master`: debe verse menos blocky en zonas con texturas finas (hojas, pasto).
    - `ffprobe <file>.mp4` confirma profile=High, bitrate ~8 Mbps, fps real.

16. Smoke test en laptop dev (libx264):
    - `make run-camera` + `make run-recording` + click "Grabar" 10s.
    - El MP4 abre y se ve coherente. CPU del worker durante encode <100% de un core (preset=medium debería dejar margen).

17. Sanity test de fan-out post-cambios:
    - WebRTC live + recording simultáneos. El stream live no debería mostrar drops nuevos (camera_worker hace lo mismo, solo que con fourcc YUYV; si la USB no aguanta, `_produce` empezaría a saltar frames y se notaría en los FPS del stream).
