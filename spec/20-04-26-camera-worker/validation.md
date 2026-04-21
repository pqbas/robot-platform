# Validation: camera-worker

La fase está lista para mergear cuando todos los checks manuales pasan y el stream funciona con reconexión automática ante desconexión física de la cámara.

## Automated Tests

- [ ] `uv run ruff check back/ camera_worker/` — sin errores de lint
- [ ] `uv run pyright back/services/camera.py back/services/camera_client.py camera_worker/main.py` — sin errores de tipo

*(No hay tests unitarios automáticos para esta fase — la interacción con V4L2 y el socket Unix requieren hardware real. Los checks manuales cubren el comportamiento crítico.)*

## Manual Checks

**Setup: dos terminales**
- Terminal A: `make run-camera`
- Terminal B: `make run-robot`

**Flujo básico:**
- [ ] Terminal A muestra `Camera opened (index=1)` y `Client connected` al conectar desde el browser
- [ ] El stream de video aparece en el frontend sin errores

**Desconexión física (el caso crítico):**
- [ ] Desconectar USB de la cámara → en ≤2s el frontend sale del spinner y muestra botón "Conectar"
- [ ] Terminal A muestra `Camera disconnected — waiting for reconnect`
- [ ] Terminal B muestra `Track stopped — closing peer connection` y `Connection state: closed`
- [ ] No aparece ningún `VIDIOC_DQBUF` u otro error V4L2 en los logs del backend (Terminal B)

**Reconexión:**
- [ ] Reconectar USB → Terminal A muestra `Camera opened (index=1)` sin reiniciar el proceso
- [ ] Hacer click en "Conectar" en el frontend → stream reanuda correctamente
- [ ] Repetir desconexión/reconexión 3 veces seguidas — el comportamiento es consistente en cada ciclo

**Restart del worker:**
- [ ] `Ctrl+C` en Terminal A (camera-worker) → Terminal B logea la pérdida de conexión al socket pero no crashea
- [ ] Reiniciar Terminal A → el backend reconecta al socket en el próximo request de frame
- [ ] El stream vuelve a funcionar sin reiniciar el backend

**Sin camera-worker corriendo:**
- [ ] Iniciar solo Terminal B (sin Terminal A) → al conectar desde el browser el backend logea error de conexión al socket y el frontend no queda en spinner (falla limpiamente)

## Post-deploy Checks

- [ ] `sudo systemctl status camera-worker` → `active (running)` en el Jetson
- [ ] `make logs-camera` → muestra `Camera opened` sin errores al iniciar
- [ ] `make logs` (backend) → no hay stack traces relacionados a `cv2` o `VideoCapture`

## Definition of Done

Todos los checks manuales pasan en el hardware del robot (Jetson con cámara ZED), el stream es estable, y la desconexión/reconexión de USB funciona en ≤2s sin intervención manual ni reinicio de servicios.
