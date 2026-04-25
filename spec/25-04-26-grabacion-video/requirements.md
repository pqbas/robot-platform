---
name: Grabación de video
description: El robot graba video MP4 durante la sesión vía un worker independiente, descargable o sincronizable al servidor.
---

# Requirements: Grabación de video

## Scope

El operador puede iniciar y detener una grabación desde la pantalla `Vision`; mientras está activa, un proceso `recording-worker` independiente persiste el stream de la cámara como MP4 en disco local. El backend FastAPI sólo orquesta (start/stop) — no toca el encoder. Cuando el robot tiene red, los videos se sincronizan al servidor y quedan listables/descargables desde el frontend del server. Es un **fallback** al conteo en tiempo real: si en el día de campo el conteo falla, el operador todavía vuelve con el video crudo para recontar offline.

Esta fase incluye un refactor de `camera_worker` para soportar **fan-out** (un productor de cámara, múltiples consumidores: backend WebRTC + recording-worker). Sin eso, dos procesos no pueden compartir la cámara V4L2.

Fuera de alcance:

- Reconteo offline a partir del video grabado (Phase 7 — nuevo método de conteo).
- Anotaciones de bounding boxes "quemadas" en el MP4 (raw video es suficiente).
- Política de retención automática.
- Captura por GStreamer (refactor completo de `camera_worker` con pipeline `tee`). Esa es una migración de mayor envergadura — fuera de alcance.

## Inputs / Data

**Tabla nueva `recordings`** (existe en robot y server, sincroniza vía push):

| Campo | Tipo | Required | Notes |
|-------|------|----------|-------|
| `uuid` | `Text` PK | Sí | Generado en robot. |
| `device_id` | `Text` | Sí | `default=get_device_id`, igual que `Session`. |
| `session_uuid` | `Text` | No | Asociación informativa a `sessions.uuid` si hay sesión activa al arrancar. Null = grabación libre. |
| `started_at` | `Text` ISO8601 | Sí | Timestamp UTC al click de "Grabar". |
| `ended_at` | `Text` ISO8601 | No | Null mientras graba. |
| `duration_seconds` | `Float` | No | Calculado al cerrar (reportado por el worker). |
| `file_path` | `Text` | Sí | Path local: `data/robot/recordings/<uuid>.mp4`. |
| `file_size_bytes` | `Integer` | No | Reportado por el worker al cerrar. |
| `width` | `Integer` | No | Reportado por el worker (handshake de cámara). |
| `height` | `Integer` | No | |
| `fps` | `Float` | No | FPS efectivo al cerrar. |
| `uploaded_at` | `Text` ISO8601 | No | Server-side: cuándo se recibió el blob. |

**Sockets Unix:**

- `/tmp/camera.sock` (existente): camera-worker → consumidores. Refactorizado para fan-out: el worker abre la cámara una sola vez y reparte cada frame a todos los clientes conectados (backend WebRTC + recording-worker). Si un cliente se atrasa, su cola se descarta (drop oldest).
- `/tmp/recording.sock` (nuevo): backend → recording-worker. Protocolo JSON length-prefixed para comandos.

**Protocolo de control `/tmp/recording.sock`:**

Request:
```json
{"cmd": "start", "uuid": "<uuid>", "output_path": "data/robot/recordings/<uuid>.mp4"}
{"cmd": "stop"}
{"cmd": "status"}
```

Response:
```json
{"ok": true, "state": "recording", "uuid": "...", "started_at": "..."}
{"ok": true, "state": "idle", "uuid": "...", "duration_seconds": 30.1, "file_size_bytes": 18000000, "width": 1280, "height": 720, "fps": 29.4}
{"ok": false, "error": "already_recording" | "not_recording" | "camera_unavailable"}
```

**Endpoints REST nuevos** (backend FastAPI):

- `POST /api/recordings/start` — robot only. Genera UUID, crea fila DB, manda `start` al worker. 409 si ya hay grabación. Devuelve la fila.
- `POST /api/recordings/stop` — robot only. Manda `stop`, lee respuesta del worker, actualiza la fila. Devuelve la fila.
- `GET /api/recordings/` — lista. Robot devuelve locales; server devuelve sincronizadas.
- `GET /api/recordings/{uuid}/file` — `StreamingResponse` del MP4 desde disco. 404 si falta.
- `DELETE /api/recordings/{uuid}` — borra fila + archivo.
- `POST /api/sync/recordings` (server) — recibe metadata batch (mismo patrón que `sync/sessions`).
- `POST /api/sync/recordings/{uuid}/upload` (server) — multipart streaming del MP4.

## Behavior

**Operador (robot):**

- En `VisionPage`, junto a los botones de conteo, aparece un botón "Grabar" con ícono de círculo rojo. Al click pasa a "Detener grabación" y muestra un badge "REC ●" parpadeante con timer sobre el video.
- Grabar e iniciar conteo son **independientes**. Si hay sesión activa al arrancar la grabación, se asocia (`session_uuid`); si la sesión termina antes que la grabación, la grabación sigue.
- Si la cámara se desconecta, el `recording-worker` detecta el cierre del socket de cámara, finaliza el MP4 limpiamente (mp4 hasta donde alcanzó es reproducible) y queda en estado idle. El backend descubre el cambio en el siguiente `status` poll y actualiza la fila.
- Si el `recording-worker` se cae (crash, OOM), systemd lo reinicia. El backend reintenta el `start` siguiente sin estado residual.
- Toast al detener: "Video guardado — 2m 14s, 18 MB". Sin diálogo de save.
- Página `RecordingsPage` (sidebar) lista los videos locales con: timestamp, duración, tamaño, estado (✓ subido / ⏳ pendiente / ⚠ archivo perdido), botones Descargar y Borrar.

**Admin (server):**

- Misma `RecordingsPage` lista grabaciones recibidas de todos los robots con filtro por device. Si todavía no se subió el blob, fila aparece sin botón Descargar.

**Sync:**

- Metadata viaja por el `push_all` existente, después de `sessions`.
- Blob se sube por canal aparte (multipart streaming), una grabación a la vez, sólo después de confirmar que la metadata está en server. Reintentos en cada ciclo hasta éxito.

## Decisions

- **Recording-worker como proceso independiente** — sigue el patrón de `camera_worker` e `inference_worker` ya establecido en Phase 3. Si PyAV explota, cae el worker, no el backend ni la UI. Si el encoding satura CPU, no compite con el event loop de FastAPI ni con el track de WebRTC. Systemd lo reinicia si muere.
- **Fan-out en camera_worker** — bloqueante. Hoy cada cliente abre su propio `cv2.VideoCapture` (línea 36 en `camera_worker/camera_worker/main.py`); V4L2 sólo permite un open, así que multi-consumidor está roto. Refactor: el worker abre la cámara **una sola vez** al primer cliente, y reparte cada frame a todos los clientes activos. Cola por cliente con drop-oldest si se atrasa.
- **Sockets separados (cámara vs control)** — el socket de cámara es alto throughput (frames raw); el de control es baja frecuencia (start/stop). Mezclar protocolos sobre el mismo socket complica el parser. Dos sockets, dos responsabilidades.
- **El worker no toca la DB** — recording-worker es un encoder dumb. La fila de `recordings` la crea/actualiza el backend antes y después del comando. Mantiene al worker libre de SQLAlchemy y reduce la superficie de cambio si cambiamos el modelo.
- **Encoder con NVENC vía GStreamer en Jetson, fallback a PyAV en laptop dev** — el codebase ya valida `nvv4l2h264enc` para WebRTC (`back/services/nvenc_codec.py:GstNvencEncoder`); reusar el mismo path nos da H.264 por hardware en grabación sin agregar plugin nuevo. CPU H.264 a 720p30 quema ~80-100% de un core en Jetson Orin; NVENC = 5-15%. La diferencia es lo que permite grabar y mantener simultáneamente WebRTC + YOLO sin degradación. El worker probeará al arrancar (igual que `detect_backend()`) y elige: (1) `nvv4l2h264enc` (Jetson), (2) `h264_nvenc` vía PyAV (desktop NVIDIA), (3) `libx264` vía PyAV (fallback laptop sin GPU).
- **Pipeline distinto al de WebRTC** — `GstNvencEncoder` actual produce byte-stream H.264 crudo para RTP (sink: `appsink`). Para grabación necesitamos archivo MP4 contenedor, así que el sink cambia a `h264parse ! mp4mux ! filesink`. Mismo encoder element, downstream distinto. Es un módulo nuevo en el recording-worker, no extends de la clase existente.
- **Sin always-on encoding** — el recording-worker no se conecta al camera socket hasta recibir `start`. En idle gasta sólo RAM, no CPU ni NVENC. El costo de la grabación es opt-in.
- **Raw video sin overlay** — recording-worker no necesita las detecciones; el MP4 queda crudo y reusable para reanálisis. Las detecciones quedan en `events`.
- **Recordings independientes pero asociables a sessions** — operador puede grabar setup antes de empezar, o seguir grabando después de parar. Asociar por `session_uuid` cuando coinciden temporalmente da trazabilidad sin forzar acoplamiento.
- **Upload de blob en canal aparte** — `aiohttp` con `FormData` y archivo abierto en streaming; nunca cargar el MP4 entero en memoria. Una grabación a la vez para no saturar la red rural.
- **Metadata se push-ea antes que el blob** — si el upload falla, el server ya conoce la grabación pendiente y el robot reintenta. Orden inverso dejaría blobs huérfanos.
- **Sin política de retención** — admin borra a mano por ahora; pendiente del roadmap si se vuelve un problema operativo.

## Context

- See `spec/roadmap.md` — Phase 6: fallback al conteo en tiempo real.
- See `spec/mission.md` — el sistema debe seguir siendo útil aún si el modelo o la red fallan.
- See `CLAUDE.md` — patrón de workers separados con uv y systemd.
- Existing patterns to follow:
  - Worker uv project: `camera_worker/` (`pyproject.toml`, `camera_worker/main.py`, comando `cd camera_worker && uv run camera-worker`).
  - Cliente sync de socket: `back/services/camera_client.py` (handshake JSON length-prefixed + frames).
  - Protocolo JSON length-prefixed: `back/services/perception/inference_client.py` (request/response).
  - Detección de encoder + pipeline GStreamer: `back/services/nvenc_codec.py` (`detect_backend`, `GstNvencEncoder._build_pipeline`) — el recording-worker espeja la lógica con sink distinto (`mp4mux ! filesink` en vez de `appsink`).
  - Migración Alembic batch-mode: `back/alembic/versions/007_device_fundo.py`.
  - Stream de archivo grande con StreamingResponse: `back/routes/counting.py:export_session_csv`.
  - Sync push de metadata: `back/services/sync_push.py:push_all`.
  - Sync receive con `successful_uuids`: `back/services/sync_receive.py`.
  - Botón con estado en VisionPage: `Conectar/Desconectar` y `Iniciar/Detener conteo` (`front/src/modules/vision/VisionPage.tsx:222`).
  - Systemd unit pattern: revisar la unidad de `camera-worker` que ya despliega `make deploy-robot`.
