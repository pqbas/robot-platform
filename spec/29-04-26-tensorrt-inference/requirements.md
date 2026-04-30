# Requirements: Inferencia YOLO con TensorRT

## Scope

El operador puede activar TensorRT por modelo desde `/settings` del robot. Al activarlo,
el robot convierte el `.pt` a `.engine` (FP16) localmente; la inferencia posterior usa
el `.engine` con la misma API actual. Modelos en modo PyTorch siguen funcionando
exactamente como hoy.

La conversión es **device-specific** y siempre corre en el robot (un `.engine`
construido en una Jetson Xavier no sirve en Orin ni en una laptop). El estado del modelo
(`pytorch | converting | tensorrt | error`) es visible por modelo en `/settings`, así el
operador sabe cuándo está listo.

Esta fase **no** cubre INT8 quantization, ni cambiar `imgsz` desde la UI, ni convertir
múltiples modelos en paralelo.

## Inputs / Data

Persistencia (DB):

| Campo en `detection_models` | Tipo | Notas |
|------------------------------|------|-------|
| `tensorrt_enabled` | `bool` (default `false`) | Si el operador quiere correr este modelo en TensorRT |
| `engine_status` | `text` (`pytorch | pending | converting | ready | error`) | Estado de la build |
| `engine_error` | `text | null` | Mensaje del último intento fallido |

Cache layout en disco (sibling del `.pt`):

```
data/robot/models/blueberry.pt
data/robot/models/blueberry.<sha256-de-pt>.fp16.engine
```

El sha del `.pt` está baked en el nombre, así que cuando el archivo cambia (re-upload del AI engineer) el matching falla y se rebuilda automáticamente.

Endpoints nuevos:

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/api/models` | — | lista modelos asignados al robot con `{uuid, filename, tensorrt_enabled, engine_status, engine_error}` |
| PUT | `/api/models/{uuid}/tensorrt` | `{ "enabled": bool }` | dispara conversión (o vuelve a PyTorch); responde `{ "engine_status": "..." }` |

Control socket nuevo `/tmp/conversion.sock` (length-prefixed JSON, mismo patrón que `recording_worker`):

```
{"cmd":"convert","pt_path":"...","engine_path":"...","precision":"fp16"}
  → {"ok":true,"started_at":"..."}                  (acepta el job, comienza)
  → {"ok":false,"error":"busy"}                     (otra conversión en curso)

{"cmd":"status"}
  → {"ok":true,"state":"idle"|"converting","current":{"pt_path":"...","started_at":"..."}|null}
```

La respuesta `start` es inmediata; el resultado (success/error) lo recoge el backend polleando `status`, no por callback.

## Behavior

- En `/settings` aparece una lista nueva "Modelos asignados" debajo de "Detección". Cada fila muestra: nombre del modelo, toggle TensorRT, badge de estado.
  - Estado `pytorch` → toggle off, badge gris "PyTorch".
  - Estado `pending` → toggle on, badge amarillo "En cola".
  - Estado `converting` → toggle on, badge amarillo "Convirtiendo... (X min)" con timer.
  - Estado `ready` → toggle on, badge verde "TensorRT FP16".
  - Estado `error` → toggle on, badge rojo "Error: <mensaje>", botón "Reintentar".
- Activar el toggle con `engine_status=pytorch`:
  1. Si el `.engine` cacheado existe (mismo hash), salta directo a `ready` sin llamar al worker.
  2. Si no existe, escribe `engine_status=pending`, manda `convert` al conversion-worker, frontend hace polling cada 5s.
- Desactivar el toggle: setea `tensorrt_enabled=false`, `engine_status=pytorch`. **No borra el `.engine`** del disco (queda en cache para si el operador re-activa).
- Si el modelo cuyo toggle se activó es el modelo **actualmente activo** en el inference-worker, al terminar la conversión el backend manda `reload_model(<.engine path>)` automáticamente. El operador no tiene que re-seleccionar.
- Si el operador trata de activar TensorRT en un segundo modelo mientras otro está convirtiendo, el endpoint responde 409 "Conversión en curso, espera a que termine". No hay queue.
- Si la conversión falla, `engine_status=error`, `tensorrt_enabled` queda `true` (la intención del operador no se pierde), badge rojo con "Reintentar".
- En modo server, la pestaña entera no aparece (mismo patrón que `device_context`).
- En dev laptop sin GPU NVIDIA + TensorRT: el conversion-worker está instalado pero la conversión falla rápido con un error claro. La feature queda inerte sin romper el resto.

## Decisions

- **Worker separado en lugar de tarea de fondo en el inference-worker** — TensorRT engine builds saturan la GPU 8 a 15 min en Jetson Xavier. Si vive en el inference-worker, baja FPS del modelo activo durante la conversión. Worker dedicado = idle = 0 CPU/GPU cuando no convierte. Espejea el patrón de `recording_worker`.
- **Conversion-worker es su propio proyecto uv en `conversion_worker/`** — el backend usa Python 3.13 (uv); en Jetson, `tensorrt` viene de JetPack atado a Python 3.10 system. No queremos forzar al backend a usar Python del sistema. El worker corre con su propio binding (system Python o uv `--system-site-packages` para heredar `tensorrt`). Symmetric con `inference/`, `camera_worker/`, `recording_worker/`.
- **Toggle en `/settings` del robot, no en `/admin/models` del servidor** — la conversión ocurre en el robot, el resultado vive en el robot, el error es local. Pedirle al admin del servidor que active TensorRT remotamente y luego adivinar si funcionó es peor UX. El operador local ve el estado en tiempo real.
- **Una conversión a la vez (no queue)** — refusing es trivialmente simple, queue requiere persistir la lista, manejar ordering y cancelación. El operador rara vez tendrá más de un modelo asignado y necesita convertirlos todos a la vez. Si más adelante hace falta, se agrega.
- **Auto-reload del modelo activo al terminar la conversión** — alternativa era esperar a que el operador re-seleccione el label. Pero ya activó el toggle: la intención de "quiero esto en TensorRT" es clara. Hacerlo automático evita un paso confuso ("ya convirtió, ¿pero por qué sigue lento?").
- **Cache key = sha del `.pt`** — alternativa era timestamp o UUID. Hash invalida automáticamente si el AI engineer re-sube el modelo con el mismo nombre. No depende de mtime (que se pierde con `cp`/sync). El hash ya existe en `DetectionModel.file_hash`, no es nuevo trabajo.
- **FP16 fijo, no FP32 ni INT8** — FP32 da poca ganancia (~1.5×). INT8 da ~6× pero requiere dataset de calibración (out of scope, agrega un flujo de captura). FP16 + Tensor Cores de Volta da el sweet spot 3 a 5× con cero data adicional.
- **Backend pollea `status` en vez de callback del worker** — request/response simple es más fácil de testear y debuggear. El polling cuesta nada (cada 5s desde el frontend baja al backend que ya tiene el estado en DB; el worker solo se consulta si el frontend insiste). Sin webhooks ni event bus.

## Context

- See `spec/roadmap.md` — Phase 11.
- See `spec/27-04-26-resolution-selector/` — patrón endpoint robot-only + JSON file en `data/robot/` + control socket al worker. Estructura paralela.
- See `spec/25-04-26-grabacion-video/` — patrón de "worker idle hasta recibir start, mismo control socket de length-prefixed JSON".
- Existing patterns to follow:
  - `recording_worker/recording_worker/main.py` — control socket asyncio, JSON length-prefixed, state machine `idle | recording`.
  - `inference/inference_worker/detector.py` — `YOLO(model_path)` ya soporta `.engine` directamente vía ultralytics; no requiere cambios de API.
  - `back/services/perception/inference_client.py` — cliente síncrono al control socket; copiar el patrón para `back/services/conversion_client.py`.
  - `back/routes/admin_models.py` — endpoints existentes sobre `DetectionModel`. Los nuevos endpoints viven aquí o en un router nuevo `models_local.py` (ver plan).
  - `front/src/modules/settings/SettingsPage.tsx` — agregar la tarjeta nueva "Modelos asignados" siguiendo el estilo de las tarjetas existentes.
