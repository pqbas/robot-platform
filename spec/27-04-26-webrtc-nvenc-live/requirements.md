---
name: WebRTC live a H.264 NVENC sin caveat
description: Eliminar la regresión de FPS del live a 1080p portando al path WebRTC la fix NVMM y los presets de calidad ya validados en el recording_worker. La infra de H.264 NVENC en aiortc ya existe; falta paridad con la fix de PR #40 y con el tuning de Phase 8.
---

# Requirements: WebRTC live a H.264 NVENC sin caveat

## Scope

Phase 9 dejó el robot capturando 1080p por default pero con un caveat operativo: el live
WebRTC en Firefox/Chrome cae a ~14 fps en lugar de 30, obligando al admin a revertir
`.env.robot` a 720p como workaround. El cause raíz es que el `GstNvencEncoder` en
`back/services/nvenc_codec.py` no tiene el bridge NVMM que requiere `nvv4l2h264enc` —
sin ese bridge, GStreamer cae a un path interno que no escala a 1080p — y además sigue
con `profile=Baseline preset-level=1 (UltraFast)` heredado, valores que el
`recording_worker` ya subió a `High` / `Slow` en Phase 8.

Esta fase entrega exclusivamente la paridad: copiar la fix NVMM (PR #40, commit
`83ae1c3`) y los presets de Phase 8 al pipeline del WebRTC, agregar logging para
confirmar qué codec se negoció, y validar end-to-end en Jetson real con un cliente
WebRTC (`about:webrtc` o `chrome://webrtc-internals/`) que el live sostiene 1080p@30 con
codec=H264.

**Dentro de alcance:**

- Insertar `nvvidconv ! video/x-raw(memory:NVMM)` en el pipeline de
  `GstNvencEncoder._build_pipeline` (el equivalente al fix del recording-worker).

- Subir `profile` a `High` y `preset-level` a `4` (Slow) en el mismo pipeline GStreamer.

- Asegurar manejo limpio de fallo de `set_state(PLAYING)` (mismo patrón que el
  recording-worker post-fix).

- Logging explícito en `init_nvenc` y al primer encode de cada peer connection: codec
  negociado (vía SDP del answer) y backend de encoder activo.

- Validar en Jetson + ZED 2i con la cámara a 3840×1080 que `about:webrtc` reporta
  `codec=H264`, `framesPerSecond ≥ 25`, `packetsLost = 0`.

- Quitar de `camera_worker/README.md` y `recording_worker/README.md` la recomendación
  del override 720p en `.env.robot` ahora que el default 1080p ya no degrada el live.

- Cerrar el caveat en `spec/roadmap.md` Phase 9 (marcar Complete con todas las cajas)
  una vez validado.

**Fuera de alcance:**

- Per-client downscale en `camera_worker` (que el live reciba 720p mientras el recording
  recibe 1080p). Esa era la Opción 1 del análisis; esta phase ataca el problema vía
  Opción 2 (encoder por hardware) y deja per-client downscale como ruta separada solo si
  esto no resuelve.

- Cambiar el path de PyAV (`PyAvNvencEncoder`) — laptop dev no tiene el caveat, no
  requiere cambios. Si en el futuro alguien lo nota, mismo patrón aplica.

- Tunear el `target_bitrate` de aiortc — aiortc adapta el bitrate a la red; subirlo
  manualmente puede causar packet loss. La queja de Phase 9 es FPS, no calidad de
  imagen.

- Migrar de `aiortc` a otra librería WebRTC.

- Tocar la negociación de `H264 perfil/level` en el SDP — aiortc ya negocia un perfil
  compatible; el monkey-patch sustituye el encoder, no el SDP.

- Audio (no aplicable).

## Inputs / Data

Sin cambios de schema, sin cambios de wire format del socket de cámara. Todos los cambios son en el pipeline GStreamer del encoder y en logging.

**`back/services/nvenc_codec.py:GstNvencEncoder._build_pipeline`**

| Antes | Después | Razón |
|-------|---------|-------|
| `appsrc ... ! videoconvert ! nvv4l2h264enc bitrate={br} preset-level=1 profile=0 control-rate=1 iframeinterval=60 ! ...` | `appsrc ... ! queue ! videoconvert ! video/x-raw,format=NV12 ! nvvidconv ! video/x-raw(memory:NVMM),format=NV12 ! nvv4l2h264enc bitrate={br} preset-level=4 profile=4 control-rate=1 iframeinterval=60 ! ...` | Bridge a NVMM (paridad con PR #40) + profile=High preset=Slow (paridad con Phase 8) |
| `pipeline.set_state(PLAYING)` sin chequeo | Chequear `Gst.StateChangeReturn.FAILURE` y limpiar pipeline / loggear antes de raisear | Falla silenciosa actual oculta el bug; el recording-worker ya tiene este chequeo |

**`back/services/nvenc_init.py`**

| Antes | Después | Razón |
|-------|---------|-------|
| `logger.info("aiortc H264Encoder patched → ...")` | Igual + un log al primer `_encode_frame` por peer connection que reporte `codec_actual=h264 backend=...` | Hoy no hay forma de confirmar desde logs si la negociación cayó a VP8 (ya forzado fuera) o si H264 entró pero el encoder se atrofia |

**`camera_worker/README.md`** y **`recording_worker/README.md`**: quitar el bloque que recomienda override 720p y reemplazarlo con una nota de que 1080p default funciona end-to-end post-Phase 10.

**`spec/roadmap.md` Phase 9**: marcar caja 3 como `[x]` y quitar el sufijo `(Shipped con caveat)` → `(Complete)` una vez validado.

## Behavior

**Operador (Jetson, default 1080p post-Phase 10):**

- Abre la pantalla Vision en su laptop. El live se ve a 1920×1080 @ 30fps sin lag
  perceptible (gesto frente a cámara → aparición en pantalla < 500 ms, comparable al
  modo 720p de Phase 8).

- Inicia grabación: el MP4 se sigue guardando a 1080p / 12 Mbps NVENC (Phase 9 no
  cambia).

- No tiene que tocar `.env.robot`. El default funciona.

**Operador (laptop dev, sin NVIDIA):**

- Sin cambios. `init_nvenc` detecta que no hay backend HW, deja el `H264Encoder`
  original (libx264) o cae a la negociación VP8 estándar de aiortc. El path PyAV NVENC
  tampoco se altera.

**Diagnóstico desde logs:**

- Al boot del backend, `init_nvenc` loggea exactamente qué encoder se monkey-patcheó
  (`PyAvNvencEncoder`, `GstNvencEncoder`, o ninguno) y el backend GStreamer detectado
  (`nvv4l2h264enc`, `nvh264enc`).

- Al primer frame de cada `RTCPeerConnection`, el encoder loggea una vez `H264 encoder
  ready (1920x1080 @ NNNN kbps backend=nvv4l2h264enc)`. Si no aparece este log durante
  una conexión, algo falló en el path H264 y el codec se cayó a otro.

## Decisions

- **Opción 2 (encoder NVENC en WebRTC) sobre Opción 1 (per-client downscale en
  camera_worker).** La infra de Opción 2 ya existe (`nvenc_codec.py`, `nvenc_init.py`,
  `init_nvenc()` ya se llama en `back/main.py`). Falla por una fix de pipeline copiable,
  no por arquitectura ausente. Opción 1 implicaría agregar colas con transformaciones
  por cliente en `camera_worker/main.py`, refactor mayor para resolver síntoma. Si esta
  phase resuelve el caveat, Opción 1 nunca tiene que existir.

- **Espejar 1:1 el fix de PR #40 del recording-worker.** El bug en ambos sides es el
  mismo (system-memory buffer → `nvv4l2h264enc` → silent drop / fallback). Inventar un
  pipeline distinto aquí abre divergencia entre dos sites que deberían comportarse
  igual. La forma correcta es copiar exactamente: `! queue ! videoconvert !
  video/x-raw,format=NV12 ! nvvidconv ! video/x-raw(memory:NVMM),format=NV12 !`.

- **Subir profile/preset al nivel del recording-worker.** Phase 8 ya hizo el trabajo de
  calibrar `profile=High preset=Slow` para 1080p en NVENC y demostró que en Jetson Orin
  el costo de preset Slow es marginal (NVENC es HW dedicado). Mantener
  Baseline/UltraFast aquí cuando el recording-worker está en High/Slow no tiene
  justificación — el live también debe verse nítido para revisión.

- **No tocar el path PyAV del encoder.** El bug es específico al pipeline GStreamer
  (`nvv4l2h264enc` y NVMM). `PyAvNvencEncoder` con `h264_nvenc` (FFmpeg) ya funciona en
  desktop NVIDIA. Cambiar PyAV sin un problema medido invita regresiones.

- **Logging "qué codec terminó negociando" como first-class.** El debugging de Phase 9
  requirió levantar Firefox `about:webrtc` y Chrome `chrome://webrtc-internals/` para
  descubrir que el codec era VP8 contra todo lo esperado. Con un log al primer encode
  podemos diagnosticar futuras regresiones desde `journalctl` directamente.

- **Quitar la recomendación de override 720p de los READMEs en la misma phase.** Si
  dejamos esa nota, el operador asume que el default no funciona, edita `.env.robot`, y
  la Phase 10 no aporta valor visible. La nota se queda solo como troubleshooting (si la
  red entre Jetson y laptop es muy débil, podés bajar a 720p para reducir bitrate
  WebRTC).

- **Cerrar el caveat de Phase 9 en `spec/roadmap.md` desde esta phase.** Phase 9 se
  marcó `(Shipped con caveat)` precisamente porque esta phase quedaba pendiente. Una vez
  validada, marcar Phase 9 `(Complete)` con la caja 3 cerrada es parte del DoD — no un
  follow-up suelto.

## Context

- See `spec/roadmap.md` — Phase 10 (esta), Phase 9 (caveat que esta phase cierra), Phase
  8 (presets NVENC validados que se reutilizan).

- See `spec/25-04-26-grabacion-1080p/validation.md` líneas 105-122 — `Resultado medido
  (post-merge)`: el dato de `framesPerSecond=14` en `about:webrtc`, throughput 200 kbps,
  RTT=3ms (red no es bottleneck).

- See `recording_worker/recording_worker/encoder.py:GstMp4Encoder._build_pipeline`
  post-PR #40 — referencia exacta del pipeline NVMM que esta phase replica al lado
  WebRTC.

- See `back/services/nvenc_codec.py:GstNvencEncoder._build_pipeline` líneas 145-193 —
  código que se modifica.

- See `back/services/nvenc_init.py` — monkey-patch que se mantiene; solo se le agrega
  logging.

- See `back/services/camera.py:CameraStreamTrack.recv` — `aiortc` consume frames `BGR` →
  `av.VideoFrame` → encoder. La cadena hasta aquí no cambia.

- See `back/main.py` líneas 23 y 30 — `init_nvenc()` ya está cableado en startup; no
  requiere cambios de invocación.

- Hardware reference: Jetson Orin con `nvv4l2h264enc` provisto por
  `nvidia-l4t-gstreamer` (JetPack). USB 3.0 confirmado en este robot. Comparar pipeline
  con `gst-inspect-1.0 nvv4l2h264enc` antes de afinar.

- Existing patterns to follow:
  - Pipeline NVMM bridge: `recording_worker/recording_worker/encoder.py:128-160` post-fix.
  - Manejo de `Gst.StateChangeReturn.FAILURE`: mismo archivo, líneas 154-160 post-fix.
  - Detección de backend: `back/services/nvenc_codec.py:detect_backend` ya elige el right encoder; no se toca.
