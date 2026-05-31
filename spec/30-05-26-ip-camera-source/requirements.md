# Requirements: IP camera source (RTSP)

## Scope

El operador puede apuntar el camera_worker a una camara IP via URL RTSP en lugar de un dispositivo USB V4L2. El resto del sistema (Unix socket fan-out, backend WebRTC, recording_worker, inference_worker) no cambia: todos los consumidores siguen recibiendo frames BGR crudos con el mismo protocolo de handshake.

## Inputs / Data

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `--rtsp-url` / `CAMERA_RTSP_URL` | string URL | No | Si esta presente, ignora `--index`. Ejemplos: `rtsp://192.168.0.50:554/stream`, `http://192.168.0.50/mjpeg` |
| `rtsp_url` en `camera_settings.json` | string | No | Persiste la URL en disco; tiene precedencia sobre el flag CLI igual que `preset` lo tiene sobre `--width/--height` |

## Behavior

- Si `rtsp_url` esta configurado (flag CLI o settings JSON), el worker abre `cv2.VideoCapture(url)` en vez de `cv2.VideoCapture(index)`.
- Para fuentes RTSP, el crop se ignora (tratado como 0): no hay camara estereo ZED que dividir.
- Los presets de resolucion (1080p/720p) no aplican a fuentes RTSP; el worker acepta la resolucion que negocie el stream.
- El mecanismo de reconexion automatica (`open_camera` en loop) funciona igual para RTSP: reintenta cada 1 s si el stream no esta disponible.
- El comando de control `reload` funciona igual: cierra el VideoCapture actual y lo reabre con la URL vigente.
- El handshake JSON (`width`, `height`, `channels`, `fps`) se envia con los valores reales negociados por el stream, igual que en V4L2.

## Decisions

- **Un solo flag `--rtsp-url`, no un flag `--source-type`** — distinguir "es URL o es entero" en `open_camera` es trivial; un flag extra solo agrega ambiguedad.
- **Crop = 0 para RTSP sin configuracion adicional** — el crop existe exclusivamente para dividir el frame estereo de la ZED 2i. Una camara IP no tiene ese layout; forzar crop=0 evita frames negros o errores de slicing.
- **No aplican FOURCC ni BUFFERSIZE para RTSP** — `cv2.CAP_PROP_FOURCC` en un VideoCapture RTSP es ignorado silenciosamente por OpenCV; quitarlo del path RTSP evita logs confusos.
- **`rtsp_url` en settings JSON sigue el mismo patron que `preset`** — `_load_preset_override` ya lee el JSON; extenderlo para leer `rtsp_url` mantiene un unico punto de configuracion en disco.
- **El backend y los workers consumidores no cambian** — el protocolo del Unix socket es identico; el cambio esta completamente contenido en `camera_worker/camera_worker/main.py`.

## Context

- Patron a seguir: `camera_worker/camera_worker/main.py` — `open_camera()`, `_load_preset_override()`, `FrameBroadcaster._produce()`
- Configuracion en disco: `data/robot/camera_settings.json` (mismo archivo que `preset`)
- Consumidores del socket (no modificar): `back/services/camera_client.py`, `recording_worker/`, `inference_worker/`
