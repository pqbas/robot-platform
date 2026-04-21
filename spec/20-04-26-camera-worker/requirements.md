# Requirements: camera-worker

## Scope

La captura V4L2 se mueve a un proceso independiente (`camera-worker`) que sirve frames raw por Unix socket. `CameraStreamTrack` deja de usar `cv2.VideoCapture` directamente y pasa a leer del socket. Esto resuelve los objetivos de Phase 2 (estabilidad de cámara) de forma definitiva: si la cámara se desconecta, el worker lo detecta, cierra la conexión al socket, y el backend recibe el cierre limpiamente sin que el event loop asyncio se vea afectado.

## Inputs / Data

El worker no recibe requests — es un servidor de streaming push. Al conectar un cliente, el worker envía un handshake y luego frames continuamente.

**Handshake (una vez, al conectar):**

| Campo | Tipo | Notas |
|-------|------|-------|
| header_len | uint32 BE | Tamaño del JSON siguiente |
| JSON | bytes | `{"width": int, "height": int, "channels": 3}` |

**Frame (repetido a ~30fps):**

| Campo | Tipo | Notas |
|-------|------|-------|
| frame_len | uint32 BE | Siempre `width * height * 3` |
| raw BGR | bytes | Frame crudo sin comprimir |

Configuración del worker vía variables de entorno (iguales a las existentes en `.env.robot`):

| Variable | Default | Descripción |
|----------|---------|-------------|
| `CAMERA_INDEX` | `1` | Índice del device V4L2 |
| `CAMERA_WIDTH` | `2560` | Ancho captura (ZED stereo) |
| `CAMERA_HEIGHT` | `720` | Alto captura |
| `CAMERA_CROP` | `1280` | Crop stereo left (0 = sin crop) |
| `CAMERA_SOCKET` | `/tmp/camera.sock` | Path del Unix socket |

## Behavior

**Worker:**
- Acepta una conexión a la vez (solo hay un stream WebRTC activo simultáneamente).
- Si la cámara se desconecta durante el stream, el worker cierra la conexión al socket y entra en loop de reconexión (reintentos cada 1s) hasta que el device vuelve a estar disponible.
- Si no hay cliente conectado, el worker sigue corriendo pero en idle (no captura frames para no bloquear V4L2 innecesariamente).
- Los frames se envían cropeados (solo canal izquierdo del ZED si `CAMERA_CROP > 0`) — el crop lo hace el worker, no el backend.

**Cliente en el backend:**
- `CameraClient` es síncrono (análogo a `InferenceClient`) — se usa desde `run_in_executor`.
- `read_frame()` bloquea hasta recibir el próximo frame o lanza excepción si el socket se cierra.
- La reconexión al socket la maneja el cliente internamente (igual que `InferenceClient.detect()`).
- `CameraStreamTrack.recv()` llama `read_frame()` en executor — si falla, llama `self.stop()` que dispara `stopped.set()` → el watcher en `stream.py` cierra el `RTCPeerConnection`.

## Decisions

- **Frames raw BGR, sin JPEG** — WebRTC ya hace encode H.264 de los frames. Agregar JPEG encode en el worker y decode en el backend sería double-encoding innecesario. A 1280×720×3 = ~2.8MB/frame × 30fps = ~84MB/s en loopback Unix socket, que es trivial.

- **Camera-worker como módulo del proyecto raíz, no proyecto uv separado** — el inference worker es un proyecto separado porque necesita torch/ultralytics que son pesados y platform-specific (Jetson vs laptop). El camera-worker solo necesita `cv2` y `numpy`, que ya están en el root. Poner todo en `camera_worker/` dentro del mismo proyecto simplifica el deploy.

- **Push streaming con un cliente a la vez** — una conexión WebRTC activa simultáneamente es el invariante del sistema (ver `close_all_connections()` en `stream.py`). No hace falta multi-client ni pull protocol. El push con un socket es el modelo más simple.

- **Crop en el worker, no en el backend** — el backend no debería saber sobre la configuración física del ZED. El worker entrega frames del tamaño final ya recortados; el cliente solo ve frames 1280×720.

- **Reconexión al socket manejada por el cliente** — mismo patrón que `InferenceClient`: si la conexión se cae, el próximo `read_frame()` intenta reconectar. Esto mantiene el backend resiliente a reinicios del worker sin cambios en `CameraStreamTrack`.

## Context

- Roadmap: Phase 3 (`spec/roadmap.md`)
- Patrón a replicar: `back/services/perception/inference_client.py` (cliente síncrono con auto-reconnect) e `inference/` (servidor de socket con systemd)
- Protocolo de socket: `back/services/perception/protocol.py` (length-prefixed, struct big-endian uint32) — misma convención, headers simplificados
- Deploy: `deploy/inference-worker.service` — el `camera-worker.service` sigue el mismo template
- `back/services/camera.py` — `CameraStreamTrack` se simplifica drásticamente al eliminar `cv2` y el lock global
