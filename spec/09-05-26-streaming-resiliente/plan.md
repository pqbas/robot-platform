# Plan: Resiliencia del streaming WebRTC

## Group 1: Detector de freeze + reconnect en el frontend

1. En `front/src/hooks/useWebRTC.ts`:
   - Refactor: extraer la creación del `RTCPeerConnection` y el offer a una función `openPeer()` reutilizable. `connect` la llama; el reconnect también la llamará.
   - Mantener el `setInterval` de FPS (líneas 78-105). Ese mismo loop ya lee `framesDecoded`.

2. En el mismo intervalo de 1 s, agregar lógica de detección de freeze:
   - Si `streamFps === 0` por **3 ciclos consecutivos** (3 s) y `pc.connectionState === "connected"`, marcar `frozen = true`.
   - Si se da `pc.connectionState === "failed"`, o `iceConnectionState === "disconnected"` sostenido por 2 ciclos, marcar `frozen = true`.

3. Agregar un controlador de reconnect:
   - Estado nuevo `reconnectAttempt: number` y `lastReconnectAt: timestamp`.
   - Backoff: `delays = [1000, 2000, 4000, 10000]`. Acumulado max ~17 s; tras 4 intentos fallidos, marcar `connectionState = "failed"` definitivo y mostrar UI de retry manual.
   - En reconnect: `pcRef.current?.close()`, esperar el delay, llamar `openPeer()`. Resetear `lastStreamSample` y `inferenceFrameCount`.
   - Cancelar pending reconnects en `disconnect()` y en unmount (`useEffect` cleanup ya existente).

4. Loguear cada paso del reconnect a console: `[WebRTC] Freeze detectado (3s sin frames decodificados), reconectando intento N`. Útil para debug en celular vía `chrome://inspect`.

5. Exponer `reconnectAttempt` desde el hook para que la UI pueda mostrar "Reconectando…" o un toast.

---

## Group 2: Health-wait al socket de cámara en el backend

6. En `back/services/camera_client.py`:
   - Nueva función helper `wait_for_socket(path: str, timeout: float)` que bloquea hasta que el path exista y un connect efímero suceda, o levanta `TimeoutError`. Usar para sondear sin consumir handshake.
   - Modificar `CameraClient._connect()` para reintentar el connect con backoff corto (200ms × 5) ante `FileNotFoundError` o `ConnectionRefusedError`, antes de levantar.

7. En `back/routes/stream.py:24-63` (`POST /offer`):
   - Antes de crear la `CameraStreamTrack`, llamar `await asyncio.to_thread(camera_client.wait_for_socket, path, timeout=10)`.
   - Si el wait falla, devolver `503` con `{"error": "camera-worker not ready"}`. El frontend, al recibir 503, espera y reintenta con el mismo backoff que Group 1.

8. En el frontend `useWebRTC.ts`, manejar respuesta `!response.ok` del fetch a `/offer`:
   - Si status `503`, programar reconnect con el siguiente delay del backoff en vez de marcar `failed`.

---

## Group 3: Retry persistente en `read_frame`

9. En `back/services/camera_client.py:58-72`:
   - Reemplazar el reconnect de un disparo por un loop con backoff: hasta `STREAM_READ_TIMEOUT_S` (default 5 s) reintentando `_disconnect()` + `_connect()` + recv. Si supera el timeout, levantar como ahora.
   - Constante en `back/config.py` o en el propio módulo: `STREAM_READ_TIMEOUT_S = 5`.

10. Confirmar que `back/services/camera.py:143-152` (`CameraStreamTrack.recv`) sigue capturando `Exception` y matando la track solo cuando el read realmente abandona — sin cambios estructurales, pero verificar el log mensaje queda claro: "Camera read failed after Ns of retries".

---

## Group 4: Forzar keyframe periódico para sobrevivir packet loss

11. Investigar en `aiortc` cómo se generan keyframes para `VideoStreamTrack` con `from_ndarray`:
    - Caso A: el encoder VP8 genera keyframe N segundos por default — verificar el intervalo (mirando `aiortc/codecs/vpx.py` o equivalente). Si es ≥5s, considerar acortarlo.
    - Caso B: aiortc honra PLI/FIR del receiver — verificar con `tcpdump`/`webrtc-internals` que los PLI llegan al backend y disparan keyframe. Si no, fix puntual en el track.

12. **Si el caso A está mal calibrado**: forzar keyframe cada 2 s desde el track (override `next_timestamp` o setear `pict_type = av.video.frame.PictureType.I` periódicamente en `recv` antes de retornar). Documentar el costo (~+15% bandwidth).

13. **Si el caso B no funciona**: agregar un handler en `pc` para `pli` recibido y forzar keyframe en la próxima `recv()`. Falla silenciosa significa que aiortc no soporta el callback — en ese caso, fallback al caso A.

14. Logging en backend: cada keyframe forzado loguea `[stream] forcing keyframe (reason=N)`. Útil para verificar que la mitigación se está disparando.

---

## Group 5: Roadmap + nota corta en CLAUDE.md (opcional)

15. Agregar Phase 24 a `spec/roadmap.md` con los 4 bullets correspondientes a los Groups 1-4.

16. Si la solución del keyframe (Group 4) requiere monkey-patch o config no obvia, agregar 2-3 líneas en `CLAUDE.md` sección "Camera Worker" o nueva sección "WebRTC streaming". Si el fix queda autocontenido, omitir.
