# Requirements: WebCodecs sobre WebSocket — HW H264 decode con control de drop

## Scope

Tercer transport de video para `/vision`: el robot envía un stream H264
Annex-B (NAL units crudos, sin muxer) sobre un WebSocket, y el navegador lo
decodifica con la `VideoDecoder` API de WebCodecs (acceso directo al
MediaCodec hardware del SoC). El target es **Android moderno (Chrome /
Edge / Samsung Internet)** sosteniendo 25–30 fps con latencia
glass-to-glass ≤ 500 ms — apto para monitoreo cercano a tiempo real —
y degradación elegante ante pérdida de red (drop de P-frames antes de
decodear, esperar al próximo keyframe).

Fuera de scope: iOS Safari (WebCodecs llegó en iOS 17 pero todavía tiene
bugs — el operador usa Android), Firefox Android (soporte parcial; algunos
codecs caen a software), teleop (latencia objetivo ≤ 500 ms es buena pero
no garantizada), y deprecar los modos `mjpeg` / `webrtc` (siguen disponibles
vía feature flag para iOS y para fallback).

## Inputs / Data

Wire format del WS `/ws/wc-stream` (server → client), un mensaje binario por frame:

```
[uint32 BE header_len][JSON header utf-8][H264 Annex-B bytes]
```

Mismo esqueleto que el path MJPEG; el payload cambia de JPEG a H264 Annex-B.

| Campo header   | Tipo    | Notas                                                                     |
|----------------|---------|---------------------------------------------------------------------------|
| `frame_id`     | int     | Monotónico, empieza en 1 al arrancar el encoder.                          |
| `timestamp_us` | int     | Microsegundos monotónicos (`frame_id * (1_000_000 / 30)`). Para `EncodedVideoChunk.timestamp`. |
| `is_keyframe`  | bool    | `true` si el NAL contiene un IDR (NAL type 5). Decidido por `Gst.BufferFlags.DELTA_UNIT` ausente. |
| `detections`   | array   | Mismo shape que el path MJPEG.                                            |
| `target_class` | string? | Idem.                                                                     |
| `session_active`, `session_total`, `error` | | Idem.                                                                 |

Cliente → server: nada (sin credit/ACK; el cliente maneja backpressure
descartando chunks antes de pasarlos al decoder).

## Behavior

- **Conexión.** Cliente abre WS. El primer chunk que llega con
  `is_keyframe: true` se usa para llamar `decoder.configure({...})` (el
  encoder emite SPS+PPS inline antes de cada keyframe via
  `h264parse config-interval=1`, así que no necesitamos un `description`
  separado). A partir de ese momento cada chunk se envuelve en un
  `EncodedVideoChunk` y se pasa a `decoder.decode()`.
- **Decoder output.** El callback `output(VideoFrame)` se invoca por cada
  frame decodificado. Lo pintamos con `ctx.drawImage(videoFrame, 0, 0)` en
  un `<canvas>` y `videoFrame.close()` inmediatamente (los `VideoFrame`
  son recursos del GPU; no cerrarlos genera leaks rápidos).
- **Drop policy en el cliente.** Si la cola interna del decoder supera 3
  (medido por `decoder.decodeQueueSize`), descartamos P-frames entrantes
  y esperamos el próximo keyframe antes de reanudar decode. Esto es lo
  que MSE no permite: cuando el render se atrasa, perdemos frames a
  propósito en vez de acumular latencia.
- **Multi-cliente.** Un solo encoder en el robot, fan-out a N clientes
  WS (mismo patrón que [[stream_broadcaster]]). Per-cliente
  `asyncio.Queue(maxsize=1)` con drop-oldest. Nuevos clientes esperan al
  próximo keyframe del encoder en curso (no se rebobina el stream).
- **Lifecycle lazy.** Encoder + camera-read se inicia al primer cliente y
  se detiene cuando el último se desconecta.
- **Reconexión.** Mismo backoff que MJPEG (1s/2s/4s/10s, 4 intentos). Al
  reconectar el cliente cierra el `VideoDecoder` viejo y crea uno nuevo;
  espera el próximo keyframe del server para `configure()` de nuevo.
- **Sin WebCodecs soportado.** Pre-check con
  `VideoDecoder.isConfigSupported({codec: "avc1.42E01E", hardwareAcceleration: "prefer-hardware"})`.
  Si `.supported === false`, el hook va a `failed` con mensaje sugiriendo
  cambiar a `mjpeg` o `webrtc` en `localStorage`. No hacemos auto-fallback.
- **Detecciones sincronizadas.** Las detections viajan en el header de cada
  frame — no hay drift entre video y overlay porque están bundleadas en
  el mismo mensaje binario (sin canal lateral).

## Decisions

- **WebCodecs en lugar de MSE** — Latencia ~100–300 ms con WebCodecs vs
  500 ms–2 s con MSE (el navegador buffer-ea fragments antes de
  presentar). Además WebCodecs da control explícito de drop, que es lo
  que necesitamos en WiFi débil. Trade-off: ~30–50 líneas más de glue JS
  (VideoDecoder lifecycle) y menos ecosistema que MSE.
- **Sin muxer en el backend (Annex-B crudo)** — Eliminamos `mp4mux` /
  `splitmuxsink` / `cmafmux` y todo el spike inicial que conllevaba. La
  pipeline GStreamer termina en `h264parse config-interval=1 ! appsink`
  con `stream-format=byte-stream`. Más simple y menos puntos de falla.
- **Bundle de detections en el header del frame** — Espeja exactamente
  el wire format del path MJPEG (`stream_ws.py`), reusa el helper
  `_pack(header, payload)` análogo. Beneficio extra: sync de overlay
  garantizado (no hay race entre canal de video y canal de meta como
  habría con un text frame paralelo).
- **`h264parse config-interval=1` para SPS/PPS inband** — Cada keyframe
  lleva SPS+PPS antes del IDR. Esto permite a clientes que reconectan
  configurar el decoder con el próximo keyframe sin handshake adicional.
  El encoder ya emite keyframes cada 30 frames (≈1 s); el cliente arranca
  decode en ≤ 1 s desde el connect.
- **Drop de P-frames en cliente, no en server** — El server no sabe qué
  cliente está lento; el cliente sí sabe su propio `decodeQueueSize`.
  Descartar en cliente preserva el broadcast (otros clientes no
  penalizados) y mantiene el cap de memoria local. El server solo dropea
  por su queue de fan-out (drop-oldest a tamaño 1).
- **Canvas en main thread en v1; OffscreenCanvas + Worker como upgrade
  opcional (Group 4 del plan)** — Antes de invertir en worker plumbing,
  medimos. Si el `drawImage(VideoFrame)` bloquea > 5 ms p99 en mobile,
  upgradeamos. Si no, no agregamos código que no aporta. Decisión guiada
  por mediciones, no por estética arquitectónica.
- **Sin auto-fallback a MJPEG o WebRTC ante WebCodecs no disponible** —
  El feature flag `localStorage.stream.mode` es explícito. Si el browser
  no soporta WebCodecs (raro en Android moderno; común en iOS y Firefox),
  el hook reporta `failed` y el usuario cambia modo manualmente. Auto-
  fallback ocultaría el A/B real entre transports.
- **Android-only oficialmente** — Chrome / Edge / Samsung Internet
  (todos Chromium) tienen WebCodecs maduro desde 2022 con H264 HW
  garantizado. Firefox Android: soporte parcial — sale del scope. iOS
  Safari ≥ 17: existe pero buggy en 17.0–17.2, no confiable. Operador
  del robot usa Android Chrome.
- **CameraClient propio (no compartido con `stream_broadcaster`)** — Mismo
  rationale que el path MJPEG: el camera_worker ya hace fan-out por
  cliente, así que un consumidor adicional no cuesta más, y compartir
  introduciría races entre threads.

## Context

- See `spec/roadmap.md` — Phase 28. WebCodecs es la solución mobile
  "real" tras concluir que MJPEG tope a ~10 fps por decode JS y WebRTC
  arrastra inestabilidad ICE/RTP.
- See `spec/11-05-26-mjpeg-ws-dual-mode/` — patrón de feature flag por
  `localStorage`, broadcaster singleton, drop-oldest fan-out, wire format
  binario con JSON header.
- See `spec/09-05-26-streaming-resiliente/` — convenciones de reconexión
  exponencial y freeze detection que `useWebCodecsStream.ts` debe espejar.
- Existing patterns to follow:
  - `back/services/stream_broadcaster.py` — broadcaster singleton + thread
    + lifecycle lazy + `_pack(header, payload)` (reusable, idéntico).
  - `back/routes/stream_ws.py` — endpoint WS con `asyncio.wait` +
    `FIRST_COMPLETED` para cleanup limpio.
  - `back/services/nvenc_codec.py` — detección de backend + pipeline
    GStreamer en Jetson (`nvv4l2h264enc`). Reusamos `detect_backend()`
    y la estructura de la pipeline, agregando solamente `h264parse` al
    final.
  - `front/src/hooks/useMjpegStream.ts` — backoff de reconexión, estado
    `ConnectionState`, parseo de wire format binario `[len][JSON][payload]`.
  - `front/src/hooks/useStream.ts` — patrón del feature flag.
