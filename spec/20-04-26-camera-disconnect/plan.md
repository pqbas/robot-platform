# Plan: Camera Disconnect

## Group 1: Backend — callback en CameraStreamTrack

1. En `back/services/camera.py`, modificar `CameraStreamTrack.__init__`:
   - Agregar parámetro `on_camera_fail: Callable[[], Awaitable[None]] | None = None`
   - Guardar como `self._on_camera_fail = on_camera_fail`
   - Agregar import de `Callable` y `Awaitable` desde `collections.abc`

2. En `CameraStreamTrack.recv()`, en los dos puntos de fallo (excepción y `ret=False`),
   agregar antes de `raise`:
   ```python
   if self._on_camera_fail:
       asyncio.ensure_future(self._on_camera_fail())
   ```
   Hacer lo mismo en el bloque `if not ret:` justo antes de
   `raise RuntimeError("Camera disconnected")`.

---

## Group 2: Backend — wiring en stream.py

3. En `back/routes/stream.py`, función `offer`, reemplazar:
   ```python
   track = camera.CameraStreamTrack()
   ```
   por:
   ```python
   async def _on_camera_fail():
       await pc.close()
       camera.pcs.discard(pc)

   track = camera.CameraStreamTrack(on_camera_fail=_on_camera_fail)
   ```
   No se necesita ningún otro cambio en `stream.py`.
