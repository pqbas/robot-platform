# Requirements: Streaming MJPEG + WebSocket (dual-mode con feature flag)

## Scope

El operador puede ver el stream de cámara + detecciones via un transport
alternativo a WebRTC: MJPEG sobre WebSocket. WebRTC permanece intacto y sigue
siendo el default; el modo se elige client-side por `localStorage.stream.mode`
(`"webrtc"` | `"mjpeg"`). El cambio no requiere recompilar ni reiniciar
servicios — un reload del frontend basta.

Multi-cliente: a diferencia de WebRTC (que cierra peers previos), MJPEG admite
N navegadores conectados simultáneamente al mismo `/ws/stream` sin que se
desconecten entre sí.

Fuera de scope: audio, grabación, NAT traversal, SFU, autenticación adicional
(la del backend aplica igual via cookie/JWT).

## Inputs / Data

WebSocket `/ws/stream` envía un mensaje binario por frame con el siguiente layout:

| Offset | Tamaño | Contenido |
|--------|--------|-----------|
| 0      | 4 B    | `uint32` big-endian = `header_len` |
| 4      | `header_len` | JSON UTF-8 con metadata del frame |
| 4+H    | resto del mensaje | JPEG bytes |

JSON header:

| Field            | Type      | Required | Notes |
|------------------|-----------|----------|-------|
| `frame_id`       | int       | yes      | Monotónico per-broadcaster |
| `detections`     | array     | yes      | Misma shape que `FrameDetectionPayload.detections` (vacía si no hay sesión activa) |
| `target_class`   | str\|null | yes      | `null` si no hay sesión |
| `session_active` | bool      | yes      | true si counter tiene sesión activa |
| `session_total`  | int       | yes      | 0 si no hay sesión |
| `error`          | str\|null | no       | Mensaje si la inferencia falló |

No hay mensajes cliente→servidor en esta fase (el toggle de `processing` se
mantiene en `POST /api/toggle_processing`).

## Behavior

**Conexión:** cliente abre `/ws/stream`. El broadcaster se inicializa lazy en
la primera conexión (no carga la cámara si nadie está viendo). Si la cámara no
está lista, el broadcaster mantiene la conexión abierta y empieza a emitir
cuando el socket esté disponible (mismo patrón de `wait_for_socket`).

**Fan-out:** un solo lectura del camera-socket → un solo encode JPEG → push a
cada cliente con cola `drop-oldest` (depth=1). Si un cliente lento no consume,
se descartan sus frames viejos, no se ralentiza el resto.

**Detecciones:** el path de inferencia es compartido con WebRTC. La sesión
activa se chequea via `counter.get_active_session()` igual que en
`back/services/camera.py`. Las detecciones se envían dentro del header JSON de
cada frame (no por canal separado).

**Desconexión:** cuando el último cliente WS se va, el broadcaster libera el
camera-socket y para el thread de captura. Si llega un nuevo cliente, vuelve
a arrancar.

**Convivencia con WebRTC:** ambos modos pueden estar mounted en el backend
simultáneamente. Si un usuario tiene WebRTC abierto en una tab y otro abre
MJPEG en otra, ambos funcionan — comparten la lectura del camera-socket via
`CameraClient` (que el camera-worker ya fan-outea).

**Edge:** dos clientes MJPEG conectados → ambos ven el mismo `frame_id` y las
mismas detecciones, sin que uno desconecte al otro.

## Decisions

- **No remover WebRTC.** WebRTC sigue siendo el path con menor bandwidth (~1
  Mbps clamped por aiortc) y es el único que escala a NAT traversal o SFU si
  en el futuro hace falta acceso público. MJPEG es la opción robusta para LAN
  / WiFi flaky pero gasta ~2–5× más bitrate. Mantener ambos y elegir por
  contexto.
- **Feature flag client-side, no env var.** El toggle vive en
  `localStorage.stream.mode` para que el operador pueda cambiar sin tocar el
  servidor. Default `webrtc` para no romper el comportamiento actual.
- **JPEG encode software (cv2) en v1.** `cv2.imencode` es portable y suficiente
  para 720p30 en Jetson. Migrar a `nvjpegenc` (GStreamer) sólo si el profile
  muestra que la CPU se satura. No premature optimization.
- **cv2 en el backend: extender el precedente existente, no romper la invariante.**
  `CLAUDE.md` lista `cv2` como import prohibido en el backend, pero la regla ya
  está parcialmente violada: `back/services/perception/inference_client.py:75`
  hace `cv2.imencode` y `back/routes/config_routes.py:74` hace `cv2.VideoCapture`.
  `stream_broadcaster.py` agrega un tercer uso del mismo patrón (encode JPEG en
  hot path), no introduce una nueva dependencia. La invariante real que importa
  — no meter `torch`/`ultralytics`/`av`/`gi` al backend para preservar startup
  rápido, crash isolation y resolución de versiones de NumPy — se mantiene
  intacta. Si en el futuro la CPU del Jetson sufre, mover el encode a
  `camera_worker` (que ya tiene los frames raw) es el siguiente paso, no
  bloquea esta fase.
- **Header binario length-prefixed, no JSON wrapper con base64.** Base64 inflaría
  el payload ~33%. El patrón length-prefixed JSON + binario ya está usado en
  `inference_client.py` y `camera_client.py` — consistencia.
- **Detecciones dentro del frame, no canal separado.** Sincronizar dos canales
  (frame + JSON) en WS es complicado (orden, drop independiente). Empaquetarlos
  juntos garantiza que el render no muestra boxes "atrasadas" respecto al frame.
- **Canvas en lugar de `<video>` para MJPEG.** El operador necesita pintar boxes
  sobre el frame; con canvas se dibujan en el mismo paso de render sin overlay
  DOM separado. WebRTC sigue con `<video>`.
- **Hook factory `useStream` con misma superficie.** Tanto `useWebRTC` como
  `useMjpegStream` devuelven `{ frameData, fps, connectionState, connect, disconnect }`.
  `VisionPage.tsx` no debe enterarse de cuál está activo.

## Context

- See `spec/roadmap.md` Phase 25 — el bullet list que esta carpeta expande.
- See `spec/09-05-26-streaming-resiliente/` — fase previa de resiliencia WebRTC.
  Esta fase NO reemplaza ese trabajo, lo complementa.
- See `CLAUDE.md` sección "Stream / WebRTC" — invariantes del path actual.
- Existing patterns to follow:
  - Fan-out + drop-oldest: `camera_worker/camera_worker/main.py`
  - Length-prefixed JSON header + binary payload: `back/services/camera_client.py:67-103`, `back/services/perception/inference_client.py`
  - Lazy worker startup en track: `back/services/camera.py:154-156` (`_first_frame`)
  - Hook surface (frame + detections + fps + reconnect): `front/src/hooks/useWebRTC.ts`
  - Router wiring: `back/main.py:25,118` (patrón `include_router`)
