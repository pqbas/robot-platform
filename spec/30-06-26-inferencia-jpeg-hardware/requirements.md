# Requirements: JPEG por hardware para la inferencia en vivo

## Scope

Sacar de la CPU la serialización de frames que hace la inferencia en vivo.
Hoy `inference_client.detect()` convierte cada frame con `cv2.cvtColor`
(YUYV→BGR) + `cv2.imencode` (JPEG) en CPU antes de mandarlo al `inference-worker`.
Esta fase reemplaza esas dos operaciones por un pipeline GStreamer
`appsrc(YUY2) ! nvvidconv ! nvjpegenc ! appsink` que produce el JPEG 100% en
hardware (VIC + encoder JPEG del Jetson), con **fallback a `cv2`** para
dev/no-Jetson y para frames que ya llegan en BGR.

Solo afecta el camino de inferencia en vivo, que corre **únicamente con una
sesión de conteo activa**. No cambia el contrato del socket: el `inference-worker`
sigue recibiendo el mismo JPEG y no se toca. No cambia el streaming (ya es
zero-CPU desde la fase `30-06-26-streaming-yuyv-sin-cpu`) ni el conteo offline.

## Inputs / Data

El frame que entra a `encode()` puede venir en dos formatos según el emisor:

| Origen del frame | Formato | Ruta de encode |
|---|---|---|
| `camera.py` (WebRTC) y `wc_broadcaster` (WebCodecs) | YUYV `(H,W,2)` | **HW** (nvjpegenc) |
| `stream_broadcaster` (MJPEG, ya pre-convertido) y dev/no-Jetson | BGR `(H,W,3)` | CPU (`cv2`) |

Salida: `bytes` de un JPEG (quality 85, igual que hoy) que el `inference-worker`
decodifica a BGR. El contrato de `/tmp/inference.sock` no cambia.

## Behavior

- **Con sesión de conteo activa, en Jetson:** los frames YUYV submitteados se
  serializan a JPEG en hardware. El `cvtColor` + `imencode` de CPU desaparecen
  de ese camino.
- **Fallback CPU:** si no hay GStreamer/`nvjpegenc` (laptop dev) o el frame llega
  en BGR (3 canales), se usa `cv2.cvtColor`(si hace falta)`+cv2.imencode` como
  hoy. Mismo resultado, mismo quality.
- **Sin sesión activa:** no se submitea ningún frame a inferencia
  (`camera.py` ya se saltea `submit_frame`), así que no se construye ni usa el
  encoder — costo cero en reposo.
- El overlay de detecciones en el navegador se ve igual (mismas cajas, mismos
  colores); la única diferencia observable es menos CPU del backend durante la
  sesión.

## Decisions

- **Módulo nuevo `perception/jpeg_encoder.py` que espeja `h264_encoder.py`.** El
  backend ya tiene el patrón de "encoder GStreamer HW con appsrc/appsink
  persistente + fallback PyAV/CPU + factory `make_*`" en `h264_encoder.py` y
  `nvenc_codec.py`. Reusar ese patrón mantiene `inference_client` delgado y
  consistente, en vez de meter Gst inline en `detect()`.
- **Trade-off aceptado: ~+11 ms de latencia por frame a cambio de ~−11 ms de CPU
  por frame.** Medido en el robot: CPU `cvtColor+imencode` = 13.3 ms/frame
  (imencode = 11.7) casi todo CPU; HW = 24.5 ms/frame de wall-time pero ~2 ms de
  CPU (el resto es VIC + encoder JPEG). La inferencia alimenta **solo el overlay**
  (no es crítica en latencia y es drop-old), así que +11 ms es invisible; el valor
  es liberar un núcleo durante la sesión.
- **HW solo para input YUYV; BGR va por CPU.** `nvjpegenc`/`nvvidconv` no aceptan
  BGR en system memory (misma razón por la que el streaming necesitó YUY2). Los
  frames ya-BGR de `stream_broadcaster` se quedan en `cv2` — no vale la pena
  re-arquitecturar ese path secundario.
- **`nvvidconv → I420` (no NV12) para alimentar `nvjpegenc`.** Ambos los acepta
  (`gst-inspect` de `nvjpegenc`: sink = I420/NV12); I420 planar es el camino
  directo y ya verificado en prototipo.
- **Pipeline persistente por instancia, lazy por resolución, rebuild si cambia.**
  Igual que `H264AnnexBEncoder`: construir el pipeline en el primer frame (cuando
  se conoce W×H) y reconstruir solo si cambia la resolución, para no pagar el
  setup por frame.
- **Mantener quality=85.** Es el valor actual; así el JPEG que ve el
  `inference-worker` no cambia y las detecciones son idénticas.
- **El helper queda reutilizable para el MJPEG (línea del roadmap), pero fuera de
  alcance acá.** `stream_broadcaster` podría más adelante alimentar YUYV a
  `nvjpegenc` y borrar también su `cvtColor`; esta fase no lo toca.

## Context

- Ver `spec/roadmap.md` — línea "Backend: encoder JPEG software (`cv2.imencode`)
  como inicio; migrar a GStreamer `nvjpegenc` si la CPU del Jetson sufre". Esta
  fase ejecuta esa migración, para el consumidor de inferencia.
- Ver `spec/30-06-26-streaming-yuyv-sin-cpu/` — dejó el socket de cámara en YUYV y
  estableció el patrón "conversión de color en el VIC". Esta fase extiende ese
  principio al JPEG de inferencia.
- Patrón a seguir: `src/back/services/h264_encoder.py` (appsrc/appsink persistente,
  fallback, factory `make_h264_encoder`).
- Código que se reemplaza: `src/back/services/perception/inference_client.py:80-82`
  (`cv2.cvtColor` + `cv2.imencode`).
- Verificaciones previas (en verde): `nvjpegenc` disponible; prototipo
  `appsrc(YUY2)!nvvidconv!I420!nvjpegenc` produce JPEG decodable con colores
  correctos (izq/centro/der = azul/verde/rojo); throughput 41 fps.
