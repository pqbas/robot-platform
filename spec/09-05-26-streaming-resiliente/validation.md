# Validation: Resiliencia del streaming WebRTC

## Automated Tests

- [ ] `uv run pytest` exits 0 sin failures (no se introdujeron regresiones).
- [ ] `uv run ruff check back/` exits 0.
- [ ] `cd front && npx tsc --noEmit` exits 0.

Specific cases que deben existir:

- [ ] Test unitario en `tests/test_camera_client.py` (nuevo o ampliado): `wait_for_socket` levanta `TimeoutError` si el path no aparece dentro del timeout, y retorna sin error si el socket está disponible. Mock con `tempfile` + `socket.AF_UNIX`.
- [ ] Test unitario para `read_frame` con retry persistente: simula falla del primer connect, éxito en el tercero — debe entregar el frame sin levantar.

## Manual Checks

### Pre-vuelo

- [ ] En el Jetson, `make run-camera` + `make run-robot` + `make run-front`. Esperar a ver "Connected to camera worker" en los logs del backend.
- [ ] Desde el celular en la misma WiFi, abrir `http://<jetson-ip>:5173/vision`. El stream arranca en ≤5 s sin pasar por `/settings`.

### Caso A — arranque sin "guardar settings"

- [ ] Detener el camera-worker (`make logs-camera` en otra terminal, `Ctrl+C` el proceso).
- [ ] Desde el celular, abrir `/vision`. El frontend muestra "Reconectando…" y no tira error inmediato.
- [ ] Levantar el camera-worker (`make run-camera`). En ≤10 s el stream arranca solo en el celular sin tocar nada más.
- [ ] Logs del backend muestran "camera-worker not ready" durante el wait y luego "Connected to camera worker" cuando aparece.

### Caso B — freeze por packet loss simulado

- [ ] Con stream corriendo, en el celular bloquear la WiFi 5 s (modo avión + apagar) y restaurar.
- [ ] Frontend detecta freeze, loguea "[WebRTC] Freeze detectado…" en console (vía `chrome://inspect`), dispara reconnect, stream vuelve en ≤15 s sin tocar settings.
- [ ] Durante el freeze, las detecciones del data channel pueden seguir o pausarse — irrelevante para esta validación.

### Caso C — freeze del síntoma original (data channel vivo, video muerto)

- [ ] Ejecutar una sesión de conteo de ≥5 minutos con el celular conectado. Generar movimiento frente a la cámara.
- [ ] Si el video se congela mientras las detecciones siguen llegando: el frontend lo detecta vía `framesDecoded` plano por 3 s y reconecta automáticamente. **No** debe ser necesario ir a `/settings → guardar` para reanimar el stream.
- [ ] Repetir el ejercicio en al menos 2 sesiones diferentes (≥10 min total) sin requerir intervención manual sobre el stream.

### Caso D — camera-worker reload mid-sesión

- [ ] Con stream activo, ir a `/settings`, cambiar resolución (1080p ↔ 720p), guardar.
- [ ] El stream se cae brevemente (camera-worker desconecta a todos con sentinel) y el frontend reconecta solo en ≤5 s con la nueva resolución.

### Caso E — reconnect agotado

- [ ] Apagar el camera-worker y mantenerlo apagado.
- [ ] El frontend reintenta 4 veces con backoff (1, 2, 4, 10 s); tras ~17 s muestra UI de "stream caído, reintentar manualmente". No queda en loop infinito.
- [ ] Encender el camera-worker y tocar el botón manual de retry → stream vuelve.

### Logs

- [ ] `make logs` durante los tests muestra mensajes claros: "Connected to camera worker", "Camera read failed after Ns of retries", "forcing keyframe", según corresponda. Sin tracebacks no manejados.

## Definition of Done

Un operador puede correr una sesión de conteo de 30+ minutos en el celular sin recurrir a `/settings → guardar` para reanimar el stream. Los modos de falla observados (no arranca, freeze mid-sesión con data channel vivo) se recuperan automáticamente con backoff visible en logs y UI.
