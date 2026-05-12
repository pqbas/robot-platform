# Validation: Streaming MJPEG + WebSocket (dual-mode con feature flag)

Implementación completa y lista para mergear cuando todos los siguientes
checks pasen.

## Automated Tests

- [ ] `uv run pytest back/tests/test_stream_broadcaster.py` exits 0
- [ ] `uv run ruff check back/` exits 0
- [ ] `cd front && npm run build` exits 0 (incluye `tsc`)
- [ ] `cd front && npm run lint` exits 0

### Specific test coverage required

- [ ] `StreamBroadcaster.add_client()` registra una cola con `maxsize=1` y arranca el thread sólo al primer cliente
- [ ] `StreamBroadcaster.remove_client(last)` detiene el thread (`_running == False`) y libera el `CameraClient`
- [ ] Dos clientes agregados reciben mensajes con el mismo `frame_id` por frame
- [ ] Cuando la cola de un cliente está llena, el `put_nowait` descarta el frame viejo (drop-oldest) sin romper el envío al resto
- [ ] `_pack(header, jpeg)` produce un buffer cuyo prefijo `uint32` big-endian = `len(header_bytes)` y los `len(jpeg)` bytes finales son el JPEG original
- [ ] `useStream()` retorna el hook MJPEG cuando `localStorage.stream.mode === "mjpeg"`, y `useWebRTC` cuando vale `"webrtc"` o está ausente

## Manual Checks

- [ ] Con `localStorage.stream.mode = "webrtc"` (o vacío) y reload → video por `<video>`, no se rompe nada del flow actual (path de regresión)
- [ ] Con `localStorage.stream.mode = "mjpeg"` y reload → video por `<canvas>` con boxes encima si hay sesión activa de counting
- [ ] Iniciar sesión de counting en modo MJPEG → `session_total` se incrementa en la UI igual que en WebRTC
- [ ] Toggle de `POST /api/toggle_processing` → afecta a ambos modos (las boxes desaparecen/reaparecen)
- [ ] Multi-cliente: abrir `/ws/stream` desde dos navegadores → ambos ven el stream simultáneo sin desconectarse entre sí
- [ ] WebRTC + MJPEG en paralelo (una tab cada uno) → ambos funcionan; el camera-worker fan-outea sin saturarse
- [ ] Cerrar el último cliente MJPEG → `make logs` muestra que el broadcaster paró su thread y liberó el `CameraClient`
- [ ] Test de WiFi flaky (red 5GHz con señal débil): MJPEG mantiene fps > 20 visibles donde WebRTC freeza al `streamFps = 0`
- [ ] Latencia subjetiva en LAN: MJPEG ≤ 300 ms entre movimiento físico y render (medir con cronómetro frente a la cámara)
- [ ] Reconnect: matar el backend (`make restart`) con MJPEG abierto → el frontend reconecta con backoff y vuelve a ver video sin reload

## Definition of Done

Todos los checks arriba marcados, branch rebased sobre `master` sin conflictos,
sin `console.log` ni `print` de debug, sin TODOs sueltos. PR de código no
incluye archivos `.md` (specs/roadmap/CLAUDE.md) — esos van en un commit/PR
separado de docs.
