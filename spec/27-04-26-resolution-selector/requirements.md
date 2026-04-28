# Requirements: Selector de resolución desde el frontend

## Scope

El operador puede alternar la resolución de captura de la cámara entre **1080p** (default, calidad máxima) y **720p** (fallback de red débil) desde la pantalla Vision, sin entrar al robot ni reiniciar servicios systemd. La elección persiste entre reinicios. La grabación toma siempre la misma resolución que el live (un solo modo activo por robot).

Hoy ese cambio existe pero requiere editar `.env.robot` y `make restart` en el Jetson — un viaje físico al robot. Esta fase lo expone como un control en el frontend.

## Inputs / Data

Persistencia: `data/robot/camera_settings.json` (sibling de `data/robot/device_context.json`).

```json
{ "preset": "1080p" }
```

Presets disponibles (cerrados, no es input libre):

| Preset  | CAMERA_WIDTH | CAMERA_HEIGHT | CAMERA_CROP | Output frame |
|---------|--------------|---------------|-------------|--------------|
| `1080p` | 3840         | 1080          | 1920        | 1920×1080    |
| `720p`  | 2560         | 720           | 1280        | 1280×720     |

Endpoints:

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET    | `/api/config/camera/resolution` | — | `{ "preset": "1080p" \| "720p" }` |
| PUT    | `/api/config/camera/resolution` | `{ "preset": "1080p" \| "720p" }` | `{ "preset": "..." }` |

Control socket camera-worker (`/tmp/camera-control.sock`, length-prefixed JSON, mismo patrón que `recording_worker`):

```
{ "cmd": "reload" }  →  { "ok": true, "width": 1920, "height": 1080, "fps": 30 }
{ "cmd": "status" }  →  { "ok": true, "width": ..., "height": ..., "fps": ... }
```

## Behavior

- El control aparece en la pantalla Vision como un toggle/select **mientras el operador no está conectado** al stream. No se puede cambiar resolución durante una sesión de conteo o grabación activa (el botón queda disabled con tooltip "Detén conteo y grabación antes de cambiar la resolución").
- Al cambiar el preset:
  1. Frontend hace `PUT /api/config/camera/resolution`.
  2. Backend escribe `data/robot/camera_settings.json` y envía `{"cmd":"reload"}` al control socket del camera-worker.
  3. Camera-worker tira la captura V4L2 actual, cierra todas las conexiones de clientes (WebRTC backend + recording-worker), y reabre la cámara con los nuevos `width/height/crop`.
  4. Si el frontend estaba conectado al live (no debería, ver punto 1), su WebRTC peer connection se cae limpiamente y muestra "Reconectando..." hasta que el operador haga click en Conectar de nuevo.
- Default cuando `camera_settings.json` no existe: `1080p`.
- Sólo afecta al robot. En modo server, el endpoint devuelve 404 (mismo patrón que `device_context`).

## Decisions

- **Dos presets cerrados, no campos libres** — el operador no debe poder elegir resoluciones que la ZED 2i no soporta. 1080p y 720p son las dos modalidades ya validadas y documentadas en `camera_worker/README.md`.
- **Live + recording comparten la misma resolución** — el camera-worker hace fan-out de un solo stream; mantener un único modo activo evita complicar settings y mantiene el camino simple. Confirmado con el usuario: "to don't try to force or complicate the settings, currently every is working very fast, and is enough".
- **Reload via control socket en vez de `systemctl restart camera-worker`** — espejea el patrón ya probado del `recording_worker` (`/tmp/recording.sock`), no requiere sudo en el backend, y deja la lógica de reabrir V4L2 dentro del worker que ya sabe cómo hacerlo.
- **JSON file en `data/robot/` en vez de fila en SQLite** — sigue el precedente de `device_context.json`, sobrevive a re-installs (la DB sí se conserva, pero el archivo es más fácil de inspeccionar/editar manualmente para soporte). Una sola fila, una sola key, no justifica una tabla.
- **Cambio sólo cuando no hay sesión activa** — alternativa era forzar reconexión silenciosa renegociando SDP en caliente, pero eso pelea con WebRTC (cambio de resolución implica re-negociar codec params) y arriesga corromper la grabación en curso. Bloquear el toggle durante sesiones es honesto y simple.
- **Aplicar el preset también afecta el bitrate del live y del recording** — no se necesitan cambios: `back/services/nvenc_codec.py` y `recording_worker/encoder.py` ya leen la altura del handshake y auto-escalan el bitrate (12 Mbps a 1080p, 8 Mbps a 720p NVENC). Un nuevo handshake post-reload arrastra el bitrate correcto.

## Context

- See `spec/roadmap.md` — Phase 11.
- See `spec/27-04-26-webrtc-nvenc-live/` — el live ya sostiene 1080p en Jetson; este toggle es de UX, no de performance.
- See `camera_worker/README.md` — los dos presets ya están documentados como override de `.env.robot`; esta fase mata ese override en favor del JSON file.
- Existing patterns to follow:
  - `recording_worker/recording_worker/main.py` — control socket length-prefixed JSON request/response.
  - `back/routes/device_context.py` — endpoint robot-only que lee un JSON cacheado en `data/robot/`.
  - `back/routes/config_routes.py` — ya tiene `GET/PUT /api/config/camera`; el endpoint nuevo va aquí.
  - `front/src/modules/vision/components/CountingConfigDialog.tsx` — dialog de settings ya existente, buen lugar para agregar el toggle de resolución (o puede ser un control inline en la action bar; ver plan).
