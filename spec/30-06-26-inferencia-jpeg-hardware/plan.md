# Plan: JPEG por hardware para la inferencia en vivo

## Group 1: módulo encoder JPEG (`perception/jpeg_encoder.py`)

1. Crear `src/back/services/perception/jpeg_encoder.py`, espejando la estructura de
   `src/back/services/h264_encoder.py`:
   - Importar `HAS_GSTREAMER` y `Gst` desde `back.services.nvenc_codec` (mismo
     import guard que usa `h264_encoder.py`), más `cv2` y `numpy`.
   - Función `_has_nvjpegenc() -> bool`: `HAS_GSTREAMER and
     Gst.ElementFactory.find("nvjpegenc") is not None`.

2. Clase `HwJpegEncoder` (GStreamer):
   - `__init__`: `self._pipeline/_src/_sink = None`, `self._w = self._h = 0`,
     `self._quality = 85`.
   - `_build_pipeline(w, h)`: `Gst.parse_launch` de
     `appsrc name=src is-live=true format=time do-timestamp=true
     caps=video/x-raw,format=YUY2,width={w},height={h},framerate=30/1
     ! nvvidconv ! video/x-raw,format=I420
     ! nvjpegenc quality={self._quality} ! image/jpeg
     ! appsink name=sink emit-signals=false sync=false max-buffers=2`.
     Guardar `_src/_sink`; `set_state(PLAYING)`; si `FAILURE`, limpiar y `raise
     RuntimeError` (igual que `H264AnnexBEncoder._build_pipeline`).
   - `encode(frame) -> bytes | None`:
     - Si `frame.ndim == 3 and frame.shape[2] == 2` (YUYV): `h, w = frame.shape[:2]`;
       (re)build si cambió la resolución; `push-buffer` con
       `Gst.Buffer.new_wrapped(frame.tobytes())`; `sample =
       self._sink.emit("try-pull-sample", 200*Gst.MSECOND)`; devolver los bytes del
       buffer (map READ → `bytes(info.data)` → unmap). Usar el mismo action-signal
       `emit("try-pull-sample", ...)` verificado en el prototipo (no
       `try_pull_sample`, que requiere el wrap de `GstApp`).
     - Si el frame **no** es YUYV (BGR u otro): delegar en `_cpu_encode(frame)`.
   - `close()` / `__del__`: `set_state(NULL)` y soltar referencias (igual que
     `H264AnnexBEncoder`).

3. Helper CPU compartido `_cpu_encode(frame, quality=85) -> bytes`:
   - Si `frame.ndim == 3 and frame.shape[2] == 2`: `cv2.cvtColor(frame,
     cv2.COLOR_YUV2BGR_YUYV)`.
   - `ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])`;
     `return buf.tobytes()`. Es exactamente la lógica que hoy vive en
     `inference_client.detect()` (líneas 80-82).

4. Clase `CpuJpegEncoder` (fallback dev/no-Jetson): `encode(frame)` →
   `_cpu_encode(frame)`; `close()` no-op. Misma interfaz que `HwJpegEncoder`.

5. Factory `make_jpeg_encoder()`:
   - `if _has_nvjpegenc(): return HwJpegEncoder()`.
   - `else: logger.info("nvjpegenc no disponible — JPEG por CPU (cv2)"); return
     CpuJpegEncoder()`.
   - Espeja `make_h264_encoder()`.

---

## Group 2: cablear en `inference_client.py`

6. `src/back/services/perception/inference_client.py`:
   - Import: `from back.services.perception.jpeg_encoder import make_jpeg_encoder`.
   - En `__init__` (donde se guarda `self._sock`/socket path): añadir
     `self._jpeg = None` (lazy — no construir el pipeline hasta el primer
     `detect`, así en reposo no reserva HW).

7. En `detect()` reemplazar el bloque de las líneas 79-82 (el `if frame.ndim==3 and
   frame.shape[2]==2: cvtColor(...)` + `cv2.imencode(...)`) por:
   - `if self._jpeg is None: self._jpeg = make_jpeg_encoder()`
   - `jpeg_bytes = self._jpeg.encode(frame)`
   - `if jpeg_bytes is None: logger.warning(...); return None` (encode HW falló).
   - Pasar `jpeg_bytes` a `send_request(self._sock, header, jpeg_bytes)` en lugar de
     `jpeg.tobytes()`.
   - El `import cv2` del módulo se mantiene (lo usa el fallback vía jpeg_encoder;
     verificar si queda algún uso directo — si no, se puede quitar, pero no es
     necesario).

8. Teardown: donde `InferenceClient` se cierra/desconecta (método `_disconnect`
   o `close` si existe; si no, añadir `close()`), llamar
   `if self._jpeg is not None: self._jpeg.close(); self._jpeg = None`. Verificar
   quién invoca el cierre desde `_InferenceWorker.stop()` en `camera.py` y encadenar
   ahí si hace falta, para no dejar el pipeline HW colgado tras la sesión.

---

## Group 3: docs

9. `CLAUDE.md`: en la nota de color/invariante añadida por la fase de streaming,
   actualizar que en Jetson el JPEG de inferencia también es hardware
   (`nvjpegenc`); el `cvtColor` de CPU en inferencia queda solo como fallback
   dev/no-Jetson. El MJPEG (`stream_broadcaster`) sigue siendo el único `cvtColor`
   de CPU obligado en producción.
10. Docstring de cabecera de `inference_client.py`: mencionar que la serialización
    a JPEG es por hardware (`nvjpegenc`) con fallback `cv2`.
