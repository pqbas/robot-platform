# Plan: WebCodecs sobre WebSocket — HW H264 decode con control de drop

## Group 1: Backend — encoder Annex-B + broadcaster + route

1. Crear `back/services/h264_encoder.py` con una clase `H264AnnexBEncoder` que envuelva el pipeline GStreamer Jetson:
   - Reusar `detect_backend()` de `back/services/nvenc_codec.py`.
   - Pipeline Jetson (sin muxer, salida Annex-B):
     ```
     appsrc name=src is-live=true format=time
       caps=video/x-raw,format=BGR,width=W,height=H,framerate=30/1
     ! videoconvert ! video/x-raw,format=BGRx
     ! nvvidconv ! video/x-raw(memory:NVMM),format=NV12
     ! nvv4l2h264enc bitrate=2000000 preset-level=4 profile=4
       control-rate=1 iframeinterval=30 maxperf-enable=true
       insert-sps-pps=true
     ! h264parse config-interval=1
     ! video/x-h264,stream-format=byte-stream,alignment=au
     ! appsink name=sink emit-signals=false sync=false
     ```
   - Fallback desktop NVIDIA / CPU: pipelines análogas reusando el branching de `back/services/nvenc_codec.py:_build_pipeline()`. Para `h264_nvenc` (PyAV) y `x264enc`, asegurarse que la salida queda en Annex-B con SPS/PPS inband por keyframe (`-bsf h264_mp4toannexb` no necesario porque ya salimos en byte-stream).
   - Exponer `push_frame(bgr_ndarray) -> Iterator[tuple[bool, bytes]]` donde el bool es `is_keyframe` (extraído de `Gst.Sample.get_buffer().get_flags() & Gst.BufferFlags.DELTA_UNIT`, ausente = keyframe).
   - Reusar el patrón de 1-frame pipelining de `back/services/nvenc_codec.py:_encode_frame()` (try_pull_sample con timeout corto).

2. Crear `back/services/wc_broadcaster.py` modelado sobre `back/services/stream_broadcaster.py`:
   - Singleton `get_wc_broadcaster()` con thread daemon "wc-broadcaster".
   - Estructura análoga a `StreamBroadcaster`: `_clients: dict[int, (loop, queue)]`, `add_client()`, `remove_client()`, `_snapshot_clients()`, `_run()`.
   - `add_client() -> (client_id, asyncio.Queue[bytes])` — queue por cliente `maxsize=1` (drop-oldest del broadcaster MJPEG es exactamente lo que queremos; clientes lentos pierden frames intermedios y agarran el siguiente keyframe).
   - `_run()` thread:
     1. `frame = camera_client.read_frame()`.
     2. `self._frame_id += 1`.
     3. Si `processing_enabled and session is not None`: `self._inference.submit_frame(frame.copy())`.
     4. Para cada `(is_keyframe, nal_bytes)` que el encoder emita:
        - Construir header dict idéntico a `stream_broadcaster._run()` (detections, target_class, session_active, session_total, error) más `frame_id`, `timestamp_us = self._frame_id * 1_000_000 // 30`, `is_keyframe`.
        - `msg = _pack(header, nal_bytes)` reusando la función helper de `stream_broadcaster.py` (extraerla a `back/services/_packet.py` si conviene compartir; o duplicar — son 3 líneas).
        - Dispatch a clientes con `loop.call_soon_threadsafe(_push_drop_oldest, queue, msg)` igual que el broadcaster MJPEG.
     - El cache `_last_result` de inferencia se reusa idéntico al broadcaster MJPEG (inferencia ~10–15 fps, video ~30 fps; sin cache habría flicker de overlay).

3. Crear `back/routes/stream_wc.py`:
   - Patrón análogo a `back/routes/stream_ws.py`, **sin credit/ACK** (sender corre libre, server drop-oldest a nivel queue).
   - `@router.websocket("/ws/wc-stream")`:
     - `await ws.accept()`.
     - `client_id, queue = broadcaster.add_client()`.
     - Sender loop: `msg = await queue.get(); await ws.send_bytes(msg)`.
     - Receiver loop: solo escucha `WebSocketDisconnect`.
     - Usar `asyncio.wait({recv, send}, return_when=FIRST_COMPLETED)` + cancel pattern del archivo MJPEG.
     - `finally: broadcaster.remove_client(client_id)`.

4. Wire el router en `back/main.py`:
   - Agregar `from back.routes.stream_wc import router as stream_wc_router` cerca de la línea 26.
   - Agregar `app.include_router(stream_wc_router)` cerca de la línea 120 (al lado de `stream_ws_router`).

---

## Group 2: Frontend — hook WebCodecs + dispatch

5. Extender `front/src/types/stream.ts`:
   - Cambiar `export type StreamMode = "webrtc" | "mjpeg"` → `"webrtc" | "mjpeg" | "wc"` (slug corto para localStorage; nombre largo "webcodecs" lo dejamos solo para logs).

6. Crear `front/src/hooks/useWebCodecsStream.ts`:
   - Firma idéntica a `useMjpegStream`: devuelve `{ canvasRef, connectionState, frameData, fps, reconnectAttempt, connect, disconnect }`.
   - Estado interno:
     - `canvasRef: RefObject<HTMLCanvasElement>` (mismo render target que MJPEG).
     - `wsRef`, `decoderRef: VideoDecoder | null`.
     - `configuredRef: boolean` — gate para `decoder.configure()` que solo corre con el primer keyframe.
     - `droppedCountRef: number` — diagnóstico para logs.
     - `reconnectTimeoutRef`, `closingRef`, `reconnectAttemptRef`: idénticos a `useMjpegStream`.
   - `connect()`:
     - Pre-check de soporte:
       ```ts
       const support = await VideoDecoder.isConfigSupported({
         codec: "avc1.42E01E",
         hardwareAcceleration: "prefer-hardware",
         optimizeForLatency: true,
       })
       if (!support.supported) { setConnectionState("failed"); return }
       ```
     - Construir decoder:
       ```ts
       const decoder = new VideoDecoder({
         output: (frame) => {
           const canvas = canvasRef.current
           if (!canvas) { frame.close(); return }
           if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
             canvas.width = frame.displayWidth
             canvas.height = frame.displayHeight
           }
           const ctx = canvas.getContext("2d")
           ctx?.drawImage(frame, 0, 0)
           frame.close()
           frameCountRef.current++
         },
         error: (e) => {
           console.error("[wc] decoder error:", e)
           setConnectionState("failed")
         },
       })
       ```
     - Abrir WS a `proto://host/ws/wc-stream`, `binaryType = "arraybuffer"`. Mismo patrón que MJPEG.
   - `ws.onmessage`:
     - Parsear wire format `[uint32 BE header_len][JSON][H264]` con `parseFrame()` (paso 7).
     - `if (header.error)` actualizar `frameData` y skip decode.
     - Si `!configuredRef.current && !header.is_keyframe`: descartar el chunk (no podemos configure sin keyframe primero). Loggear una vez por reconexión.
     - Si `!configuredRef.current && header.is_keyframe`:
       ```ts
       decoder.configure({
         codec: "avc1.42E01E",
         hardwareAcceleration: "prefer-hardware",
         optimizeForLatency: true,
       })
       configuredRef.current = true
       ```
     - Drop policy:
       ```ts
       if (decoder.decodeQueueSize > 3 && !header.is_keyframe) {
         droppedCountRef.current++
         return  // skip P-frame; wait for next I-frame
       }
       ```
     - Construir chunk y decodear:
       ```ts
       const chunk = new EncodedVideoChunk({
         type: header.is_keyframe ? "key" : "delta",
         timestamp: header.timestamp_us,
         data: nalBytes,
       })
       decoder.decode(chunk)
       setFrameData({ /* mismo shape que MJPEG */ })
       if (header.session_active) inferenceFrameCountRef.current++
       ```
   - FPS counter: `frameCountRef` incrementa en el output callback (frames realmente decodificados). Mismo `setInterval(1000)` que MJPEG para emitir `setFps`. Loggear `droppedCountRef` por intervalo si > 0 a INFO.
   - Reconnect: mismo backoff `RECONNECT_DELAYS` y mismo patrón `openWsRef + scheduleReconnect` que `useMjpegStream`. Al reconectar: cerrar y reset decoder (`decoder.close()`), `configuredRef.current = false`.
   - `disconnect()`: cerrar WS, `decoder.close()`, limpiar refs, reset estado.

7. Extraer el parser del wire format a `front/src/lib/streamFraming.ts`:
   - Función `parseFrame(buf: ArrayBuffer): { header: any, payload: Uint8Array }`:
     - Leer `uint32 BE header_len` en offset 0.
     - Decodificar bytes `[4, 4+header_len)` como utf-8 JSON.
     - Slice `[4+header_len, end)` como payload.
   - Actualizar `useMjpegStream.ts:140-163` para usar la nueva función — refactor de oportunidad para un solo lugar canónico.

8. Extender `front/src/hooks/useStream.ts`:
   - `readMode()`:
     ```ts
     const value = localStorage.getItem("stream.mode")
     if (value === "webrtc") return "webrtc"
     if (value === "wc") return "wc"
     return "mjpeg"
     ```
   - En `useStream()`, agregar un tercer branch antes del `webrtc`:
     ```ts
     if (MODE === "wc") {
       const h = useWebCodecsStream()
       return { kind: "canvas", mediaRef: h.canvasRef, ... }
     }
     ```
   - Mantener el comentario "Read once at module load" — modo fijo por page lifetime.

---

## Group 3: Validación + smoke

9. Smoke backend — agregar `back/tests/test_wc_broadcaster.py` (si pytest configurado; sino documentar como script manual `scripts/wc_smoke.py`):
   - Test: `H264AnnexBEncoder.push_frame(zeros((480,640,3)))` emite primero un chunk con `is_keyframe=True` cuyos primeros bytes después de los start codes (`00 00 00 01`) contienen NAL type 7 (SPS), 8 (PPS) y 5 (IDR) — parseo simple buscando los start codes en los primeros 200 bytes.
   - Test: subsecuentes frames (después del primer GOP) son `is_keyframe=False`.
   - Test: dos `add_client()` consecutivos comparten el mismo encoder y reciben fan-out (verificable con queues separadas que terminan con el mismo `frame_id`).
   - Test: `remove_client` del último cliente para el thread en ≤ 1 s.

10. Smoke frontend — agregar `front/src/hooks/__tests__/useWebCodecsStream.test.ts` si vitest configurado, sino script de smoke manual:
    - Test (jsdom con polyfill o mock): `connect()` retorna `connectionState === "failed"` cuando `VideoDecoder.isConfigSupported` devuelve `supported: false`.
    - Test (jsdom): `connect()` abre WS al endpoint `/ws/wc-stream`.

11. Documentar en `back/routes/README.md` (sección "WebSocket endpoints" si existe, sino crearla) que `/ws/wc-stream` es público — espejo de `/ws/stream`.

---

## Group 4: (Opcional, post-measurement) OffscreenCanvas + Worker render

12. Medir primero en mobile real: instrumentar `useWebCodecsStream` para loggear `performance.now()` antes/después de `ctx.drawImage(frame)` cada 30 frames. Si el p99 < 5 ms, omitir este grupo entero.

13. Si p99 ≥ 5 ms o se observa main-thread blocking visible:
    - Crear `front/src/workers/streamRenderer.worker.ts`.
    - `canvasRef.current.transferControlToOffscreen()` y postear el `OffscreenCanvas` al worker una vez al montar.
    - En `decoder.output` callback, `worker.postMessage({ frame }, [frame])` — `VideoFrame` es transferable, no se copia.
    - Worker hace `ctx.drawImage(msg.frame, 0, 0); msg.frame.close()`.
    - Validar: FPS no regresa, drift entre detection overlay y video sigue ≤ 100 ms (el overlay se sigue dibujando en main thread, pero el setState ocurre al mismo tiempo que el postMessage).
