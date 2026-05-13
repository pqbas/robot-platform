# Validation: WebCodecs sobre WebSocket — HW H264 decode con control de drop

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `uv run pytest back/tests/test_wc_broadcaster.py` exits 0 (o el smoke equivalente si la suite aún no existe)
- [ ] `make run-front` levanta el dev server sin errores TypeScript (`tsc --noEmit` limpio)
- [ ] `make run-robot` arranca con `from back.routes.stream_wc import router` resoluble, sin import errors

### Specific test coverage required

- [ ] `H264AnnexBEncoder.push_frame(zeros((480,640,3)))` emite primero un chunk con `is_keyframe=True` que contiene SPS (NAL type 7), PPS (NAL type 8) e IDR (NAL type 5) detectables en los primeros 200 bytes
- [ ] Subsecuentes frames dentro del mismo GOP retornan `is_keyframe=False`
- [ ] Dos clientes consecutivos del broadcaster reciben el mismo `frame_id` cuando consumen ambas queues simultáneamente (fan-out real, un solo encoder)
- [ ] `get_wc_broadcaster().remove_client(last_id)` para el thread en ≤ 1 s (verificable con `thread.is_alive()` tras `time.sleep(1.5)`)
- [ ] `useWebCodecsStream` retorna `connectionState === "failed"` cuando `VideoDecoder.isConfigSupported` devuelve `{supported: false}` (mock en jsdom)
- [ ] `parseFrame(buf)` extrae correctamente header JSON + payload binario; `useMjpegStream` sigue funcionando tras el refactor (test ya existente no regresa)

## Manual Checks

- [ ] **Path por defecto sigue siendo MJPEG.** Con `localStorage` limpio, `/vision` arranca en modo MJPEG. El feature flag explícito por usuario no cambió.
- [ ] **WebCodecs activable.** `localStorage.setItem("stream.mode", "wc")` + reload → `/vision` muestra video en un `<canvas>` (no `<video>`). `useStream` reporta `kind === "canvas"`.
- [ ] **Android Chrome mobile.** Conectado al robot por WiFi: la cámara aparece en ≤ 2 s del page load (espera al primer keyframe — encoder emite cada 1 s), FPS ≥ 25 sostenido tras 5 min, latencia glass-to-glass (timer en pantalla → cámara apuntada al timer → ver delta) ≤ 500 ms.
- [ ] **HW decode confirmado.** En Android Chrome devtools: `chrome://media-internals` muestra el decoder usando `Mediacodec` (no `FFmpegVideoDecoder`). Si aparece SW, abrir issue — algo está mal en el codec string o en el config.
- [ ] **Detection boxes alineados.** Con una sesión de conteo activa, las cajas aparecen sobre el objeto correcto con drift ≤ 50 ms (el header viaja con el frame; debería ser cero drift modulo el delay de inferencia).
- [ ] **Drop policy funciona.** Throttle artificial del decoder (e.g. desktop devtools → throttle CPU 6x slowdown): el FPS reportado baja pero el video no acumula latencia visible (timer en pantalla mantiene < 1 s de delta). En logs aparece `[wc] dropped N P-frames waiting for keyframe`. Tras quitar el throttle, FPS se recupera en ≤ 2 s.
- [ ] **Multi-cliente.** 2 tabs Android + 1 desktop Chrome simultáneamente: ninguno baja de 25 fps por más de 2 s sostenidos. Desconectar un cliente no afecta a los otros.
- [ ] **Reconexión.** Apagar/encender WiFi del celular: el hook va a `connectionState === "failed"`, intenta reconectar con backoff 1/2/4/10 s, y al recuperar la red el `VideoDecoder` se cierra, se reabre, y reanuda decode con el próximo keyframe. Sin OOM ni leaks visibles tras 5 ciclos de corte.
- [ ] **Sin regresión MJPEG.** `localStorage.setItem("stream.mode", "mjpeg")` + reload → fps esperado (~10 mobile, ~30 desktop), reconexión funcional, counting OK, `parseFrame` compartido no rompió nada.
- [ ] **Sin regresión WebRTC.** `localStorage.setItem("stream.mode", "webrtc")` + reload → WebRTC sigue conectando, fps ≥ 28 desktop, freeze detector intacto.
- [ ] **Sin WebCodecs soportado.** En un navegador sin `VideoDecoder` (Firefox Android viejo, iOS Safari < 17, o devtools nuleando `window.VideoDecoder` antes de reload) → `connectionState === "failed"` con mensaje sugiriendo cambiar modo. No crash, no auto-fallback silencioso.
- [ ] **Lifecycle limpio.** Cerrar la única tab abierta → `make logs` muestra "wc-broadcaster thread stopped" en ≤ 2 s; thread daemon termina (verificable con un nuevo cliente que reinicia con log `started`).
- [ ] **Counting end-to-end.** Iniciar sesión de conteo desde `/vision` en modo `wc`, mover objeto cruzando la línea, ver el contador incrementar y el `target_class` del overlay actualizarse en sync con el frame.
- [ ] **VideoFrame leak check.** Tras 5 min de stream sostenido, devtools → memory → heap snapshot: no debe haber > 5 `VideoFrame` retenidos. Indica que el `frame.close()` en el output callback funciona.

## Definition of Done

Todos los checkboxes anteriores marcados, el dev tree limpio, sin `console.log`
de debug ni TODOs en código de producción. La PR de código no incluye archivos
`.md` (los specs van en PR separada de docs por convención del repo). Group 4
(OffscreenCanvas + Worker) se skipea si la medición del paso 12 muestra
`drawImage` p99 < 5 ms en mobile real.
