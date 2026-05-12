# Requirements: Resiliencia del streaming WebRTC

## Scope

El operador (en celular o laptop conectado al WiFi del robot) abre `/vision`, ve el video en vivo y se mantiene viéndolo durante toda una sesión de conteo sin tener que pasar por `/settings → guardar` para "reanimar" el stream.

Esta fase elimina dos modos de falla observados:

1. **El stream no arranca al primer offer**: si el camera-worker está aún arrancando o el cliente WebRTC pierde el primer frame, la track muere y solo se recupera tras un `reload` del worker disparado por "guardar settings".
2. **El stream se congela mid-sesión** sobre un peer connection que sigue vivo: el data channel sigue entregando detecciones (SCTP retransmite), el camera-worker sigue produciendo frames, pero el video del cliente queda fijo en el último frame bueno. La causa más probable es pérdida de un keyframe en la WiFi sin que aiortc responda al PLI/FIR del receiver — el decoder espera un keyframe que no llega. El backend NO detecta esto (su `recv()` sigue corriendo), y el frontend tampoco (porque `connectionState` sigue `connected`).

Fuera de scope:
- Cambios al protocolo del camera-worker (queue size, política de drop). El fan-out con drop-oldest se mantiene; el cliente debe ser resiliente a drops.
- Mejoras al pipeline de inferencia o al data channel.
- Recovery cross-network (Tailscale Funnel) — el streaming es solo LAN.

## Behavior

Flow esperado tras esta fase:

1. Operador abre `/vision` en el celular sin haber tocado `/settings`. El stream arranca en ≤5 s aunque el camera-worker tarde en estar listo (espera con backoff y reintenta).
2. Durante una sesión de conteo, el frontend detecta dos clases de falla y dispara un nuevo offer:
   - **Connection failure**: `connectionState === "failed"` o `iceConnectionState === "disconnected"` sostenido más de 5 s.
   - **Frame stall**: el contador `framesDecoded` (vía `getStats()`) no avanza por más de 3 s aunque el peer siga `connected` — síntoma exacto del freeze observado mientras las detecciones del data channel seguían llegando.

   Reconnect con backoff (1s, 2s, 4s, capped a 10s, hasta 30 s acumulado o intervención manual).
3. El backend, ante un `read_frame()` fallido, reintenta conectar al socket de la cámara con backoff dentro del mismo `recv()` por hasta N segundos antes de abandonar la track. Si el socket no existe (camera-worker no arrancó), espera a que aparezca con timeout configurable.
4. "Guardar settings" sigue funcionando como antes (reload del worker), pero ya no es la única vía para recuperar el stream.

Edge cases:
- Camera-worker apagado al hacer offer → backend espera hasta `STREAM_CAMERA_WAIT_S` (default 10s) antes de cerrar la track con error claro en logs.
- WiFi cae 5 s, vuelve → frontend re-ofrece, stream vuelve sin acción del operador.
- Camera-worker reinicia (crash o reload manual) durante la sesión → backend reintenta connect, frontend re-ofrece si la track murió. Resultado: stream vuelve solo.

## Decisions

- **PLI handler ya existe end-to-end; bajar keyframe interval + log diagnóstico** — investigando durante la implementación: aiortc recibe PLI y setea `__force_keyframe`; `nvenc_codec.py` lo honra con `GstForceKeyUnit`. La cadena está completa. Lo que faltaba era: (a) visibilidad — agregamos log INFO en cada keyframe forzado para confirmar que el celular sí pide y nosotros sí respondemos; (b) belt-and-suspenders — `iframeinterval=60` (2s) es demasiado entre PLIs si la WiFi pierde el keyframe inmediato; bajamos a 30 (1s). El código muerto de keyframe periódico en `camera.py` se elimina porque el encoder real es `nvenc_codec`, no el default de aiortc.
- **Reconnect en frontend, no auto-recovery en la misma `RTCPeerConnection`** — `aiortc` no soporta ICE restart limpio en este flujo. La forma más simple y robusta es cerrar el PC fallido y crear uno nuevo con un offer fresco. Coincide con lo que hace "guardar settings" implícitamente.
- **Detector de freeze por `framesDecoded` antes que por `connectionState`** — el síntoma reportado es PC vivo + data channel activo + video congelado. `connectionState` no detecta este caso. Polling de `framesDecoded` en el intervalo de FPS que ya existe (`useWebRTC.ts:78-105`) es la señal correcta.
- **Retry persistente con backoff en `CameraClient.read_frame`, no un disparo único** — la lógica actual (`back/services/camera_client.py:60-68`) abandona muy rápido. Ampliarla para reconectar por hasta N segundos antes de levantar la excepción permite recuperar drops temporales del fan-out sin matar la track.
- **Health-wait en el `/offer` handler** — antes de aceptar el offer y crear la track, esperar a que `/tmp/camera.sock` exista y acepte conexión. Evita el modo de falla "abrí /vision antes de que el camera-worker estuviera arriba". Timeout corto (5-10 s) para no congelar al cliente.
- **No tocar el camera-worker** — el drop-oldest está bien para producir bajo presión; el bug está del lado del consumidor que no se re-engancha. Cambiar la política del worker afectaría a recording-worker e inference-worker, fuera de scope.
- **Backoff capeado y abandonado tras 30 s** — si después de 30 s sigue fallando, mostrar UI de "stream caído, reintentar manualmente" en vez de loop infinito. Evita drenar batería en el celular si hay un problema real.
- **Dejar logs detallados en el primer ciclo** — cada reconexión loguea ruta, intento N y tiempo total, para que cuando un operador reporte "se cae" tengamos evidencia en `make logs`.

## Context

- See `spec/roadmap.md` — Phase 24.
- Existing patterns to follow:
  - `back/services/camera_client.py:58-72` — `read_frame` con reconnect de un disparo (a extender).
  - `back/services/camera.py:143-176` — `CameraStreamTrack.recv` (donde captura la excepción y mata la track).
  - `back/routes/stream.py:24-63` — `POST /offer` (donde insertar el health-wait al socket).
  - `front/src/hooks/useWebRTC.ts:26-126` — hook actual sin reconnect.
  - `camera_worker/camera_worker/main.py:128-323` — fan-out con drop-oldest (no se modifica, solo referencia).
- Síntoma reportado por el usuario en sesión 09-05-26: al ver el stream en celular conectado al WiFi del Jetson, el video se congela mid-sesión y solo se recupera entrando a `/settings` y guardando.
