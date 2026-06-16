# Requirements: Conteo diferido (counting worker)

## Scope

El conteo de arándanos deja de calcularse en vivo y pasa a un **worker offline
que reprocesa el video grabado** cuando la sesión termina. Tras detener una
sesión, el video se encola en el `counting-worker`, que lo decodifica frame a
frame, corre detección + ByteTrack + cruce de línea, y produce: (1) el conteo
autoritativo y (2) un sidecar de detecciones `{uuid}.jsonl` **alineado al frame
por construcción**. La detección en vivo queda como overlay puramente visual
(que el operador valide que sí se detectan los arándanos), sin contar.

Después de esta fase, el operador detiene la sesión, ve "procesando…" y al rato
el número final; y la auditoría (replay con bboxes) deja de mostrar cajas
desalineadas. **Fuera de alcance:** quemar el overlay en un MP4 anotado
(`annotated.mp4`) — se evalúa como follow-up.

## Inputs / Data

**Job al `counting-worker`** (socket `/tmp/counting.sock`, JSON length-prefixed,
espejo de `conversion-worker`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `cmd` | string | `"count"` \| `"status"` |
| `video_path` | string | Ruta absoluta al `{uuid}.mp4` |
| `jsonl_path` | string | Ruta absoluta de salida del sidecar `{uuid}.jsonl` |
| `engine_path` | string | `.engine` del modelo activo (mismo que carga el inference-worker) |
| `target_class` | string | Clase a contar |
| `count_mode` | string | `"horizontal"` \| `"vertical"` |
| `threshold` | float | Posición de línea normalizada [0,1] |
| `direction` | string | `top2down` \| `down2top` \| `left2right` \| `right2left` |
| `roi_mode` | string | `"square"` \| `"full"` (mismo crop que en vivo) |
| `confidence` | float | Umbral de confianza |

**Respuesta `status`:** `{state: "idle"|"counting", current, last_result}` donde
`last_result = {ok, total_count, frames, duration_seconds, finished_at}` o
`{ok: false, error, finished_at}`.

**Columnas nuevas en `recordings`** (migración Alembic):

| Columna | Tipo | Notas |
|---------|------|-------|
| `count_status` | TEXT, default `'none'` | `none`\|`pending`\|`counting`\|`done`\|`error` |
| `count` | INTEGER, nullable | Conteo autoritativo cuando `done` |
| `count_error` | TEXT, nullable | Mensaje cuando `error` |
| `count_config` | TEXT, nullable | Snapshot JSON de la config de conteo **+ identidad del modelo** usada (reproducibilidad) |

El `count_config` snapshot fija (pin) el modelo que produjo el conteo, no solo
la config de cruce de línea:

```jsonc
{
  "count_mode": "...", "threshold": 0.5, "direction": "...",
  "roi_mode": "...", "confidence": 0.25, "target_class": "...",
  "model_uuid":    "<DetectionModel.uuid>",
  "model_version": "blueberry-v2",
  "file_hash":     "<sha256>",        // identifica el engine exacto
  "engine_path":   "data/robot/models/blueberry.<hash>.fp16.engine"
}
```

## Behavior

- **Disparo:** al final de `POST /api/counting/stop`, después de que
  `stop_recording` devuelve ok (el MP4 ya está finalizado por el
  recording-worker), el backend encola el job y marca el `Recording` como
  `count_status='counting'` con el `count_config` snapshot.
- **Worker:** un job a la vez (segundo job → `busy`). Idle = sin thread, 0% GPU.
  Decodifica el MP4, por frame `YOLO.predict` → ByteTrack → `ObjectCounter`, y
  escribe una línea JSONL por frame (alineada por índice). Al terminar reporta
  `total_count`.
- **Poller backend:** mientras haya un `Recording` en `counting`, poolea
  `status()` cada 5 s; al ver `last_result` transcribe a DB (`done`+`count` o
  `error`+`count_error`) y, si ya existe un `Session` con ese `recording_uuid`,
  hace backfill de `Session.total_count`.
- **Guardado:** el operador guarda la sesión sin esperar al conteo; el
  `SaveDialog` y la lista de sesiones muestran "procesando…" hasta que el poller
  rellene el número. No se bloquea al operador.
- **En vivo:** durante una sesión de conteo se sigue corriendo inferencia para
  el overlay visual, pero con `predict` (sin tracker) y **sin** acumular conteo;
  se retira `counter.update`, el logging en vivo de `detection_recorder`, y el
  `session_total` por data-channel.
- **Re-conteo:** `POST /api/recordings/{uuid}/recount` re-encola un video ya
  grabado. Por defecto **reproduce** el número original usando el modelo fijado
  en su `count_config` (mismo `file_hash` → mismo engine → determinista). Con
  `?use_active_model=true` re-cuenta con el modelo activo actual (re-contar
  videos viejos con un modelo mejorado) y actualiza el pin en `count_config`.
- **Reconciliación en arranque:** cualquier `Recording` en `count_status='counting'`
  al bootear el backend es huérfano (el worker es otro proceso, estaba idle) →
  se vuelve a encolar si el MP4 **y el engine fijado** existen; si falta el MP4
  o el engine (`file_hash` ya no cacheado) se marca `error` con el motivo.

## Decisions

- **Re-detectar desde el MP4 (no trackear sobre el JSONL en vivo)** — el video
  es la fuente de verdad: reproducible (cambias el modelo → re-cuentas) y
  determinista. El JSONL en vivo venía desfasado y no servía para auditar.
- **El desalineamiento se elimina, no se mitiga** — offline, la caja del frame N
  se calcula con los píxeles del frame N; al pintarla sobre el frame N el
  alineamiento es exacto por construcción. El pipeline en vivo (cámara → JPEG →
  socket → worker → data-channel) tiene latencia variable que hace que el bbox
  que llega al render corresponda a un frame más viejo; a 6 fps eso deriva y se
  ve "arrastrado". No es arreglable sin sincronizar timestamps entre 4 procesos.
- **ByteTrack (sin GMC) en el worker** — el cuello de botella del live (ver
  `spec/29-04-26-inference-perf/tracker-bottleneck-findings.md`) era el GMC
  optical-flow de BoT-SORT. Offline a fps nativo no hace falta compensación de
  movimiento y el tracking asocia mejor con frames juntos (33 ms vs 167 ms).
- **Estado de conteo en `Recording`, no en `Session`** — el artefacto es el
  video, que existe desde el `start`; el `Session` solo se crea al guardar. El
  poller hace backfill de `Session.total_count` cuando el conteo termina.
- **No bloquear el guardado esperando el conteo** — el conteo offline tarda
  ~minutos; el operador ya pasó al siguiente camellón. Se guarda y el número se
  rellena async (fiel a la filosofía de worker + poller que ya usa conversión).
- **Worker espejo de `conversion-worker`** — mismo molde (socket de control,
  un thread por job, `busy`, idle sin GPU, poller que transcribe `last_result`).
  Minimiza superficie nueva y reusa un patrón ya probado en el repo.
- **`ObjectCounter` se copia al worker** (no se comparte con el backend) — los
  workers son proyectos uv aislados; el backend no importa código de worker y
  viceversa (invariante del repo). Son ~60 líneas de geometría pura.
- **Sidecar JSONL regenerado (no MP4 anotado) en esta fase** — ya existe el
  replay cliente (`spec/30-05-26-session-detection-replay`) que consume el JSONL
  y lo pinta en canvas; regenerarlo alineado resuelve el desync reusando esa UI.
  El `annotated.mp4` quemado es aditivo y más pesado → follow-up.
- **El modelo se fija (pin), no se asume "el activo"** — al contar se snapshotea
  `model_uuid` + `version` + `file_hash` en `count_config`. El modelo activo es
  un blanco móvil: sin fijarlo, un re-count meses después usaría otro modelo y el
  número no sería reproducible (rompe la auditoría, que es el objetivo). El
  `file_hash` está horneado en el nombre del engine (`<stem>.<hash>.fp16.engine`),
  así que `(uuid, file_hash)` identifica el engine exacto y al arrancar se puede
  validar que sigue en disco antes de contar. El conteo inicial usa el modelo
  activo de ese momento; el re-count reproduce ese pin salvo `use_active_model`.
- **El worker usa el `.engine` fijado** — mismo formato que el inference-worker;
  offline podría usarse uno más pesado, pero se difiere para mantener la fase
  acotada (el override de re-count ya abre la puerta a re-contar con otro modelo).

## Context

- See `spec/roadmap.md` — extiende "conteo por cruce de línea" hacia conteo
  diferido y auditable; debería entrar como nueva fase del roadmap.
- See `spec/29-04-26-inference-perf/tracker-bottleneck-findings.md` — la razón
  de mover el tracker a offline (GMC ~131 ms/frame en vivo).
- See `spec/30-05-26-detection-log` y `spec/30-05-26-session-detection-replay` —
  el sidecar JSONL y el replay que esta fase vuelve confiable.
- Patrones a seguir: `src/conversion_worker/conversion_worker/main.py` (worker),
  `src/back/services/perception/conversion_client.py` (cliente),
  `src/back/services/perception/conversion_poller.py` (poller + reconciliación),
  `src/back/services/perception/object_counter.py` (cruce de línea),
  `src/inference_worker/inference_worker/detector.py` (detect + ROI crop).
