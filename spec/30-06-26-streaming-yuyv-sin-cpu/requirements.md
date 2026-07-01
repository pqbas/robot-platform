# Requirements: Streaming YUYV sin conversión de color en CPU

## Scope

Eliminar las **dos** conversiones de color por software que hoy existen en el
camino cámara → encoder, sin bajar la resolución (1080p se mantiene). La cámara
entrega **YUYV crudo** (`CAP_PROP_CONVERT_RGB=0`) en vez de dejar que OpenCV lo
decodifique a BGR, y en el encoder `nvvidconv` (VIC, hardware) convierte
`YUY2 (sysmem) → NV12 (NVMM)` directamente, eliminando el `videoconvert` de CPU.

Después de esta fase, servir el stream WebRTC en vivo y grabar consumen
notablemente menos CPU en `robot-platform` y `camera-worker`, con el encode 100%
en hardware (VIC + NVENC) como hasta ahora. La calidad, resolución y fps no
cambian.

Ambos consumidores del socket de cámara (`camera_client` del backend WebRTC y el
cliente propio del `recording-worker`) se migran a YUYV **a la vez**, porque el
socket sirve un único formato en su fan-out.

## Inputs / Data

El handshake del socket de cámara (`/tmp/camera.sock`) cambia un solo campo:

| Campo | Antes | Después | Notas |
|-------|-------|---------|-------|
| `channels` | `3` (BGR) | `2` (YUYV 4:2:2 empaquetado) | Ambos clientes ya leen `channels` del handshake y adaptan el `reshape` a `(H, W, 2)` sin cambios |
| `width` / `height` / `fps` | igual | igual | 1920×1080 @ 30 (sin cambio) |

Cada frame por el socket pasa de 6.2 MB (BGR) a 4.15 MB (YUYV) → **−33% de
tráfico**. Formato de pixel GStreamer: `YUY2` (equivalente al FOURCC `YUYV`).

## Behavior

- **Streaming normal (sin sesión de conteo activa):** cero conversiones de color
  en CPU. YUYV crudo va del socket al `appsrc` y `nvvidconv`/NVENC hacen el resto
  en hardware.
- **Con sesión de conteo activa:** la inferencia en vivo necesita BGR. La
  conversión `YUYV → BGR` ocurre **solo** en `inference_client.analyze()` (que ya
  usa `cv2`), sobre los frames submitteados con drop-old — nunca en el camino
  caliente del stream.
- **Fallback no-Jetson (`libx264`):** ese pipeline sigue esperando BGR; convierte
  `YUYV → BGR` solo en esa rama. En Jetson (ruta real de producción) no se
  convierte nunca.
- **Grabación:** el `recording-worker` recibe YUYV y su pipeline pasa a
  `appsrc(YUY2) → nvvidconv → NV12(NVMM) → nvv4l2h264enc`, quitando también su
  `videoconvert`.

## Decisions

- **Migrar ambos consumidores a YUYV a la vez, en vez de negociar formato
  por-cliente en el handshake.** El fan-out del camera-worker sirve un único
  buffer a todos los clientes; mantener dos formatos obligaría a convertir en el
  worker (justo lo que queremos evitar). Un solo formato en el socket es más
  simple y más barato.
- **`channels=2` en el handshake en vez de un campo `format` nuevo.** Los dos
  clientes ya reshapean con `channels` leído del handshake, así que el reshape a
  `(H, W, 2)` sale gratis. Un campo `format` explícito sería más limpio pero
  añade cambios en 3 sitios sin beneficio real hoy (solo hay un formato objetivo).
- **La conversión YUYV→BGR para inferencia vive en `inference_client.analyze()`,
  no en `camera.py`.** `inference_client` ya importa `cv2` (`cv2.imencode`), así
  que la conversión es consistente ahí y `camera.py` no gana un import de `cv2`.
  Además solo corre con sesión activa y sobre frames drop-old.
- **Mantener 1080p; no tocar resolución ni fps.** El objetivo es puramente quitar
  CPU del camino, no cambiar la calidad.
- **`nvvidconv` acepta `YUY2` en system memory** (verificado en sus sink caps y
  con un prototipo `gst-launch`), a diferencia de `BGR` en sysmem que devuelve
  frames negros — por eso el pipeline actual necesitaba `videoconvert` para BGR y
  el nuevo no lo necesita para YUY2.
- **El crop `frame[:, :out_width]` exige ancho par en YUYV** (el macropíxel YUYV
  abarca 2 columnas). Con esta cámara el crop es no-op (máx YUYV = 1920×1080 y
  `out_width=1920`), pero se fuerza par por robustez ante otros presets/cámaras.

## Context

- Ver `spec/roadmap.md` — expande la línea de streaming WebRTC/NVENC en vivo
  (`spec/27-04-26-webrtc-nvenc-live/`) y comparte el patrón de captura YUYV que ya
  usa la grabación (roadmap: "recording-worker graba con captura YUYV").
- Ver `spec/09-05-26-streaming-resiliente/` — el freeze-detector del front
  reconecta el stream tras el corte de camera-worker durante el deploy.
- Verificaciones previas que fundamentan esta fase (todas en verde):
  - `nvvidconv` acepta `YUY2` sysmem → prototipo `gst-launch` corrió limpio.
  - `/dev/video4` ofrece solo YUYV 4:2:2; máx 1920×1080; stream real a 1920×1080.
  - El backend **no** dibuja overlays (detecciones van por data channel).
  - OpenCV respeta `CAP_PROP_CONVERT_RGB=0` en esta cámara → `(1080,1920,2)`.
- Patrones a seguir:
  - Pipeline HW de referencia: `nvenc_codec.py:196-208` (rama `nvv4l2h264enc`).
  - Cliente de cámara del backend: `back/services/camera_client.py` (reshape por
    `channels`).
  - Cliente + encoder del recording: `recording_worker/main.py` (handshake) y
    `recording_worker/encoder.py:159-176` (pipeline).
