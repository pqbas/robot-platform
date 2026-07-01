# Plan: Streaming YUYV sin conversión de color en CPU

> **Alcance corregido (durante la implementación):** el socket de cámara tiene
> **cuatro** consumidores, no dos. Además de WebRTC y grabación, existen dos
> transportes por WebSocket seleccionables desde el front (`useStream.ts`,
> `localStorage("stream.mode")`, **default = `wc`**):
> - **`wc` (WebCodecs, el default)**: `stream_wc` → `wc_broadcaster.py` →
>   `h264_encoder.py`. **Tiene el mismo `videoconvert` de CPU que WebRTC** — es
>   el path que realmente consume la CPU medida (~72%). Se migra a zero-CPU.
> - **`mjpeg` (fallback)**: `stream_ws` → `stream_broadcaster.py` →
>   `cv2.imencode(".jpg")`. JPEG exige BGR → conversión `YUYV→BGR` inevitable,
>   pero es un camino secundario.
>
> Pipelines **zero-CPU** tras esta fase: WebRTC (`nvenc_codec.py`), WebCodecs
> (`h264_encoder.py`), grabación (`recording_worker/encoder.py`).
> Único `cvtColor` sobreviviente: MJPEG (`stream_broadcaster.py`) e inferencia
> (`inference_client.detect`), ambos en caminos secundarios / bajo demanda.
>
> Enfoque uniforme en los pipelines GStreamer: `appsrc` emite `YUY2` en **todas**
> las ramas; se elimina `videoconvert` **solo** en la rama `nvv4l2h264enc`
> (Jetson, producción). Las ramas `nvh264enc`/`x264enc` (dev/dGPU) conservan su
> `videoconvert`, que ahora convierte desde `YUY2` — sin `to_ndarray` ramificado.

## Group 1: camera-worker — emitir YUYV crudo  ✅ HECHO

1. `src/camera_worker/camera_worker/main.py`, apertura V4L2: `cap.set(
   cv2.CAP_PROP_CONVERT_RGB, 0)`; loguear `cap.get(...)`; **abortar** si el
   driver lo ignora (`>= 0.5`).
2. Handshake: `"channels": 3` → `"channels": 2`.
3. Crop: `out_width` forzado par (`& ~1`) en ambas asignaciones.
4. Docstring de cabecera: "raw BGR" → "raw YUYV (YUY2 4:2:2)".

> **Caveat RTSP:** el `open_camera` RTSP (no-V4L2) sigue devolviendo BGR, pero el
> handshake ahora anuncia `channels=2`. La ruta RTSP queda incompatible con esta
> fase (fuera de alcance; producción usa V4L2 USB). Documentar, no soportar.

---

## Group 2: WebRTC — `nvenc_codec.py` (GstNvencEncoder)

5. `appsrc_caps` (línea ~178): `format=BGR` → `format=YUY2`.
6. Rama `nvv4l2h264enc` (líneas 197-209): eliminar `! videoconvert !
   video/x-raw,format=BGRx`; dejar `... ! queue ! nvvidconv !
   video/x-raw(memory:NVMM),format=NV12 ! nvv4l2h264enc ...`. Actualizar el
   comentario (líneas 182-196) que explica el porqué del `videoconvert`.
7. `_encode_frame` (línea 331): `raw = frame.to_ndarray(format="yuyv422")
   .tobytes()` (era `bgr24`).
8. Ramas `nvh264enc`/`x264enc`: sin cambios (conservan `videoconvert`, que ahora
   parte de `YUY2`).

## Group 2b: WebCodecs (`wc`, el default) — `h264_encoder.py`

9. `H264AnnexBEncoder._build_pipeline`: mismo cambio que Group 2 —
   `appsrc_caps` `format=BGR`→`YUY2` (línea ~57); rama `nvv4l2h264enc`
   (líneas 65-82) elimina `! queue ! videoconvert ! video/x-raw,format=BGRx`,
   deja `! queue ! nvvidconv ! NV12(NVMM)`. Actualizar comentario 62-64.
10. `H264AnnexBEncoder.push_frame` (línea 132): renombrar el parámetro `bgr` →
    `frame`; `raw = frame.tobytes()` (el buffer YUY2 mide `w*h*2`, correcto).
11. `H264AnnexBEncoderPyAV.push_frame` (fallback dev, línea 227): si
    `frame.shape[2] == 2`, `av.VideoFrame.from_ndarray(frame, "yuyv422")
    .reformat("yuv420p")` en vez de `bgr[:, :, ::-1]` + `rgb24`.
12. `wc_broadcaster.py`: pasa el frame crudo a `push_frame` (línea 165) — **sin
    cambio**; verificar que no asume 3 canales antes de encodear.

## Group 2c: track WebRTC — `camera.py`

13. `CameraStreamTrack.recv` (línea 171): `av.VideoFrame.from_ndarray(frame,
    format="yuyv422")` (era `bgr24`). `submit_frame(frame.copy())` sigue pasando
    YUYV; la conversión para inferencia va en el paso 14.

## Group 2d: inferencia — `inference_client.py`

14. `detect()` (línea ~75), antes de `cv2.imencode`: si `frame.ndim == 3 and
    frame.shape[2] == 2`, `frame = cv2.cvtColor(frame, cv2.COLOR_YUV2BGR_YUYV)`.
    Cubre los frames submitteados desde los tres broadcasters + WebRTC.

## Group 2e: MJPEG (fallback) — `stream_broadcaster.py`

15. `_run` (tras `read_frame`, línea ~136): convertir una vez `YUYV→BGR` si
    `frame.shape[2] == 2`, de modo que tanto `cv2.imencode(".jpg")` (línea 150)
    como `submit_frame` reciban BGR. `inference_client.detect` verá 3 canales y
    no reconvierte (sin doble conversión). Es el único path con `cvtColor`
    forzado por el JPEG; documentar el porqué en un comentario.

---

## Group 3: recording-worker — pipeline YUY2

16. `src/recording_worker/recording_worker/main.py`: cliente lee `channels` del
    handshake → `(H, W, 2)` automático. Verificar que `read_frame` no asuma 3.
17. `encoder.py` `GstMp4Encoder._build_pipeline` (líneas 159-178): `appsrc`
    `format=BGR`→`YUY2`; eliminar `! videoconvert ! video/x-raw,format=NV12`;
    dejar `! queue ! nvvidconv ! NV12(NVMM) ! nvv4l2h264enc ...`. Actualizar
    comentario 152-158 ("BGR from the camera worker" → YUYV).
18. `encoder.py` `PyAvEncoder.write_frame` (línea 329): si `frame.shape[2] == 2`,
    `av.VideoFrame.from_ndarray(frame, "yuyv422").reformat(...)` en vez de
    `format="bgr24"`. (Fallback desktop; producción usa `GstMp4Encoder`.)
19. `write_frame` de `GstMp4Encoder` (línea 205): `frame.tobytes()` genérico —
    sin cambio; buffer YUY2 tiene tamaño correcto.

---

## Group 4: Docs / invariantes

20. `CLAUDE.md`: sección "Sockets Unix" (`/tmp/camera.sock` sirve **YUYV**) y nota
    en "Invariantes" (fan-out YUYV; conversión de color 100% hardware VIC en los
    tres pipelines HW; MJPEG e inferencia son los únicos con `cvtColor` CPU).
21. Docstrings de cabecera: `camera_worker/main.py` (hecho en Group 1) y
    `recording_worker/main.py` ("raw BGR frames" → YUYV).
