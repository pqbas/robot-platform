# Requirements: Camera Disconnect

## Scope

Cuando la cámara USB se desconecta físicamente, la peer connection WebRTC se
cierra limpiamente desde el backend. El frontend recibe el evento de cierre y
sale del estado "cargando", mostrando el botón "Conectar" para reintentar sin
necesidad de reiniciar el backend.

El manejo de excepción en `recv()` ya existe y detiene el track (`self.stop()`).
Esta fase agrega solo el cierre del `pc` que hoy queda huérfano.

## Behavior

- Cuando `recv()` detecta fallo de cámara (excepción o `ret=False`), además de
  detener el track, cierra el `RTCPeerConnection` asociado.
- El browser recibe `connectionstatechange → "closed"` → `useWebRTC.ts` pone
  `connectionState = "failed"` → `VisionPage` muestra el botón "Conectar".
- No hay cambios de frontend: `useWebRTC.ts` ya maneja el estado `"failed"`
  correctamente (línea 39).
- Si la cámara cae durante una sesión de conteo, el operador ve el botón
  "Conectar" y puede reconectar sin reiniciar el backend.

## Decisions

- **Callback `on_camera_fail` en `CameraStreamTrack`** — en lugar de pasar el
  `pc` directamente al track, se pasa una función async. Así `camera.py` no
  importa ni conoce `RTCPeerConnection`; el acoplamiento queda en `stream.py`
  donde ya se crea el `pc`.

- **`asyncio.ensure_future` para llamar el callback desde `recv()`** — `recv()`
  es async y puede crear la tarea directamente antes de re-lanzar la excepción.
  No hay necesidad de `loop.call_soon_threadsafe` porque `recv()` siempre corre
  en el event loop.

- **Sin cambios de frontend** — `useWebRTC.ts` ya tiene el handler de
  `"closed"` → `"failed"` y `VisionPage` ya muestra "Conectar" en ese estado.

## Context

- `back/services/camera.py` — `CameraStreamTrack.recv()` y `__init__`
- `back/routes/stream.py` — aquí se crea el `pc` y el `track`; aquí se pasa
  el callback
- `front/src/hooks/useWebRTC.ts` — ya maneja `connectionState === "failed"` (sin cambios)
- `spec/roadmap.md` — Phase 2: Estabilidad de cámara WebRTC
