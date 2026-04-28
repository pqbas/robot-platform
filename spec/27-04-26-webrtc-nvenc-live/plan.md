# Plan: WebRTC live a H.264 NVENC sin caveat

## Group 1: Pipeline NVMM bridge en `GstNvencEncoder`

1. Editar `back/services/nvenc_codec.py:GstNvencEncoder._build_pipeline` (líneas 145-193). Reemplazar el string del pipeline para el branch `nvv4l2h264enc`:
   - Antes: `appsrc ... ! videoconvert ! nvv4l2h264enc bitrate={target_bitrate} preset-level=1 profile=0 control-rate=1 iframeinterval=60 ! ...`.
   - Después:
     ```python
     pipeline_str = (
         "appsrc name=src is-live=true format=time do-timestamp=false "
         f"caps=video/x-raw,format=BGR,width={width},height={height},"
         "framerate=30/1 "
         "! queue "
         "! videoconvert "
         "! video/x-raw,format=NV12 "
         "! nvvidconv "
         "! video/x-raw(memory:NVMM),format=NV12 "
         f"! nvv4l2h264enc bitrate={self.target_bitrate} "
         "preset-level=4 profile=4 control-rate=1 "
         "iframeinterval=60 "
         "! video/x-h264,stream-format=byte-stream,alignment=au "
         "! appsink name=sink emit-signals=false sync=false"
     )
     ```
   - Mantener intactos los branches `nvh264enc` y fallback `x264enc`. Solo el branch `nvv4l2h264enc` se modifica.
   - Mantener `do-timestamp=false`. A diferencia del recording-worker (que persiste a disco y necesita PTS coherente), aquí aiortc setea `pts` y `time_base` en `CameraStreamTrack.recv` antes de pasar el frame al encoder; cambiar a `do-timestamp=true` en este path puede romper la sincronización RTP.

2. En el mismo archivo, agregar comentario justo antes del pipeline_str que explique por qué el bridge NVMM existe (1-2 líneas: `nvv4l2h264enc only accepts NVMM-tagged buffers; the bridge converts NV12 system-memory → NV12 NVMM`). Apuntar al archivo del recording-worker como referencia (`# Mirrors recording_worker/.../encoder.py post-PR #40`).

3. En el mismo archivo, después de `self._pipeline = Gst.parse_launch(pipeline_str)` y antes de `self._pipeline.set_state(Gst.State.PLAYING)`, capturar el return value del `set_state` y manejar el fallo:
   - `ret = self._pipeline.set_state(Gst.State.PLAYING)`
   - `if ret == Gst.StateChangeReturn.FAILURE: self._pipeline.set_state(Gst.State.NULL); self._pipeline = None; logger.error("..."); raise RuntimeError("GStreamer pipeline failed to enter PLAYING state")`.
   - Patrón idéntico a `recording_worker/recording_worker/encoder.py:GstMp4Encoder.start` post-fix.

---

## Group 2: Logging diagnóstico

4. Editar `back/services/nvenc_init.py:init_nvenc`. Después de `logger.info("aiortc H264Encoder patched → ...")`, agregar un segundo log que liste las preferencias de codec resultantes:
   - `from aiortc.codecs import CODECS`
   - `logger.info("aiortc video codec preferences after patch: %s", [c.mimeType for c in CODECS["video"]])`
   - Esto deja en `journalctl -u robot-platform` evidencia explícita de que VP8 fue removido y H264 quedó como única opción.

5. Editar `back/services/nvenc_codec.py:GstNvencEncoder._build_pipeline`. Justo antes del return implícito (al final de la función, después del `logger.info("GStreamer pipeline ready: ...")` ya existente), agregar un campo `self._negotiated_log_done = False` en `__init__` y, en `_encode_frame` la primera vez que se procesa un frame por instancia, loguear:
   - `if not self._negotiated_log_done: logger.info("WebRTC H264 encoder live: %s @ %dx%d %d kbps", self._encoder_element, frame.width, frame.height, self.target_bitrate // 1000); self._negotiated_log_done = True`.
   - El objetivo es tener una huella por peer connection que confirme que el path NVENC realmente recibe frames (no que solo el monkey-patch corrió).

6. Mismo patrón en `back/services/nvenc_codec.py:PyAvNvencEncoder._encode_frame`. Agregar el mismo `_first_log` para consistencia con el branch GStreamer y dejar evidencia en logs cuando se usa h264_nvenc desktop.

---

## Group 3: Documentación

7. Editar `camera_worker/README.md`. Buscar la sección que recomienda el override 720p en `.env.robot`. Reemplazar por un bloque tipo "Troubleshooting" que diga:
   - 1080p es el default y funciona end-to-end con NVENC en Jetson + recording-worker + WebRTC live.
   - Solo bajar a 720p (`CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`) si la red entre Jetson y la laptop del operador es débil (RTT > 200 ms o packet loss > 2%).
   - Apuntar al `recording_worker/README.md` para el bitrate y a esta phase (`spec/27-04-26-webrtc-nvenc-live/`) para el fix WebRTC.

8. Editar `recording_worker/README.md`. Idéntico tratamiento de la nota de override 720p. El bitrate auto-escalado por altura no cambia.

9. Editar `CLAUDE.md` sección "Camera Worker". Confirmar que el bullet `Para volver a 720p: ...` queda como nota operativa (no como recomendación), o moverlo a una subsección de Troubleshooting si la línea actual sugiere que 720p es preferible.

---

## Group 4: Validación e integración

10. Build local + tipos:
    - `cd back && uv run python -c "from back.services.nvenc_codec import detect_backend, GstNvencEncoder, PyAvNvencEncoder; print(detect_backend())"` exits 0.
    - `cd back && uv run python -c "from back.services.nvenc_init import init_nvenc; init_nvenc()"` no raisea (en laptop dev sin NVENC, debe loggear "No hardware encoder found, keeping default libx264" y retornar).
    - `cd front && npx tsc --noEmit` exits 0 (no debería tocar TS, sanity).
    - `cd back && uv run pytest` exits 0 (no agrega tests; verifica no regresión).

11. Deploy a Jetson:
    - `make restart` → `systemctl status robot-platform` active.
    - `journalctl -u robot-platform -n 50 --no-pager` muestra:
      - `aiortc H264Encoder patched → GstNvencEncoder (nvv4l2h264enc)`.
      - `aiortc video codec preferences after patch: ['video/H264']` (sin VP8).

12. Validación en cliente WebRTC (ver `validation.md` para los criterios exactos):
    - Abrir Firefox sobre la red local del Jetson, conectar al stream.
    - `about:webrtc` → buscar el peer connection activo → confirmar `codec=H264 framesPerSecond ≥ 25 framesDropped=0`.
    - Repetir con Chrome `chrome://webrtc-internals/` para descartar bug específico de browser.

13. Cerrar el caveat de Phase 9:
    - Editar `spec/roadmap.md`: en `## Phase 9: Resolución mayor en grabación (Shipped con caveat)`:
      - Cambiar título a `## Phase 9: Resolución mayor en grabación (Complete)`.
      - Marcar la caja 3 como `[x]`. Reescribir el texto: `[x] La transmisión en vivo no sufre regresión perceptible de FPS o latencia mientras se graba a la nueva resolución — resuelto por Phase 10 (WebRTC live a H.264 NVENC con bridge NVMM).`
