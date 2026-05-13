# Plan: Streaming MJPEG + WebSocket (dual-mode con feature flag)

## Group 1: Backend — broadcaster compartido

1. Crear `back/services/stream_broadcaster.py`:
   - Clase `StreamBroadcaster` (singleton accedido via `get_broadcaster()`).
   - Atributos: `_clients: dict[int, asyncio.Queue[bytes]]`, `_lock`, `_thread`, `_running`, `_frame_id: int`.
   - Reusa `CameraClient(config.camera.socket_path)` para leer BGR raw — mismo cliente que `back/services/camera.py:134`.
   - Reusa la lógica de `_InferenceWorker` de `back/services/camera.py:29-127` (extraer a clase compartida en este mismo archivo, o importarla — preferir importar para no duplicar).
   - Método `add_client() -> tuple[int, asyncio.Queue]`: registra una cola con `maxsize=1`, arranca el thread si era el primero. Devuelve `(client_id, queue)`.
   - Método `remove_client(client_id)`: descarta la cola; si era el último, marca `_running = False` para que el thread libere el socket.
   - Método `_run()` (thread): loop infinito mientras `_running`, lee frame, encodea JPEG con `cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])`, despacha inferencia si hay sesión activa (mismo gate que `back/services/camera.py:161`), arma el mensaje binario, hace `queue.put_nowait()` por cada cliente (con `try/except QueueFull: queue.get_nowait(); queue.put_nowait()` para drop-oldest).
   - Función `_pack(header: dict, jpeg: bytes) -> bytes`: `struct.pack(">I", len(header_bytes)) + header_bytes + jpeg`.

2. `cv2` en el backend ya está aceptado (ver Decisions en `requirements.md`): `back/services/perception/inference_client.py:75` usa `cv2.imencode` con el mismo patrón. Importar `cv2` directo en `stream_broadcaster.py` y continuar — no es bloqueo.

3. Crear `back/routes/stream_ws.py`:
   - `router = APIRouter()`.
   - `@router.websocket("/ws/stream")`: acepta el WS, llama `broadcaster.add_client()`, loop `while True: msg = await queue.get(); await ws.send_bytes(msg)`. Maneja `WebSocketDisconnect` → `broadcaster.remove_client(client_id)`.
   - No requiere auth en robot mode (mismo principio que `/offer`). En server mode revisar `back/services/auth_guard.py` — el guard actual aplica a `/api/*`; `/ws/stream` queda fuera por path. Si se desea auth en server mode, agregar dependency `Depends(get_current_user)` aquí (consultar al usuario antes).

4. Wire en `back/main.py`:
   - Importar `from back.routes.stream_ws import router as stream_ws_router`.
   - `app.include_router(stream_ws_router)` justo después de `stream_router` (línea 118).

---

## Group 2: Frontend — hook MJPEG + factory

5. Crear `front/src/hooks/useMjpegStream.ts`:
   - Misma superficie que `useWebRTC`: devuelve `{ canvasRef, connectionState, frameData, fps, reconnectAttempt, connect, disconnect }`.
   - Diferencia: `canvasRef` en vez de `videoRef` (el caller decide qué renderizar).
   - Abre `new WebSocket(\`ws://\${location.host}/ws/stream\`)` con `binaryType = "arraybuffer"`.
   - `onmessage`: parsea `DataView.getUint32(0)` para `header_len`, decodifica `TextDecoder().decode(buf.slice(4, 4+H))` → JSON, el resto es JPEG.
     - JPEG → `new Blob([jpegBytes], { type: "image/jpeg" })` → `createImageBitmap(blob)` → `canvasRef.current.getContext("2d").drawImage(bitmap, 0, 0)`.
     - JSON → `setFrameData(...)` (misma shape que `FrameData` de `@/types`).
   - Reconnect con la misma curva de backoff que `useWebRTC` (`RECONNECT_DELAYS`).
   - FPS: contar frames recibidos en una ventana de 1s — mismo patrón que `inferenceFrameCount` en `useWebRTC.ts:24-25`.

6. Crear `front/src/hooks/useStream.ts`:
   - Factory que retorna `useWebRTC()` o `useMjpegStream()` según `localStorage.getItem("stream.mode")` (default `"webrtc"`).
   - Ambos hooks deben exponer el mismo type `StreamHandle` — definir en `front/src/types/stream.ts` (nuevo archivo) o en el propio `useStream.ts`.
   - **Atención hooks rules:** no se puede llamar uno u otro condicionalmente dentro del mismo `useStream`. Solución: `useStream` lee el modo una vez al mount (no reactivo), y siempre llama al mismo hook por toda la vida del componente. Si el usuario cambia el flag, debe reloadear.

7. Adaptar `front/src/modules/vision/components/VideoStream.tsx`:
   - Soportar ambos: si `videoRef` está presente, renderizar `<video>` (path actual). Si `canvasRef` está presente, renderizar `<canvas>`.
   - Tipar props como union discriminada: `{ kind: "video", videoRef } | { kind: "canvas", canvasRef }`. Los overlays (`DetectionOverlay`, `CountingLineOverlay`, `RoiOverlay`) ya leen `videoRef`; revisar si necesitan adaptarse a canvas (probablemente leer `width/height` del elemento — abstraer en un hook `useStreamSize`).

8. Adaptar `front/src/modules/vision/VisionPage.tsx`:
   - Reemplazar `const { videoRef, ... } = useWebRTC()` (línea 38) por `const stream = useStream()`.
   - Pasar `stream.videoRef ?? stream.canvasRef` y `stream.kind` a `<VideoStream>`.
   - Todo lo demás (`frameData`, `connectionState`, `connect`) se mantiene idéntico — esa es la promesa del factory.

---

## Group 3: Config UI + tests

9. Agregar un toggle dev-only en algún settings page (o consola del browser por ahora):
   - **Mínimo viable:** dejar el toggle solo accessible via `localStorage.setItem("stream.mode", "mjpeg")` + reload. Documentar en `CLAUDE.md`.
   - **Opcional v1.1:** botón en `VisionPage` (debug-only, behind `import.meta.env.DEV`) que toggle el flag y reload.

10. Test backend `tests/test_stream_broadcaster.py` (si no hay `tests/` aún, ubicar donde corresponda):
    - Mock `CameraClient.read_frame` para retornar un ndarray fijo.
    - `add_client()` x2 → ambos reciben el mismo `frame_id` en su queue.
    - `remove_client(last)` → el thread se detiene (assert `_running == False` tras un sleep corto).
    - `_pack` produce un blob con el header_len correcto y los JPEG bytes intactos.

11. Smoke test frontend manual (no automated): `localStorage.setItem("stream.mode", "mjpeg")` + reload + verificar video + boxes en una sesión activa de counting.
