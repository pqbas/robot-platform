# Validation: Selector de resolución desde el frontend

Implementation is complete and ready to merge when all of the following pass.

## Automated Tests

- [ ] `cd front && npm run build` exits 0 (TypeScript + Vite build limpio).
- [ ] `cd back && uv run ruff check` exits 0 sin errores nuevos.
- [ ] `uv run pytest back/tests/` exits 0 (si hay tests; si no, marcar N/A).

### Specific test coverage required

- [ ] `back/services/camera_settings.read_preset()` con archivo ausente devuelve `"1080p"` (default).
- [ ] `back/services/camera_settings.read_preset()` con JSON corrupto devuelve `"1080p"` y loguea warning.
- [ ] `back/services/camera_settings.write_preset("720p")` escribe `data/robot/camera_settings.json` con `{"preset": "720p"}` y la siguiente lectura lo confirma.
- [ ] `back/services/camera_settings.write_preset("foo")` levanta `ValueError` (preset inválido).
- [ ] `PUT /api/config/camera/resolution` con preset inválido devuelve 422 (FastAPI validación).
- [ ] `PUT /api/config/camera/resolution` con sesión de conteo activa devuelve 409 con mensaje claro.
- [ ] `PUT /api/config/camera/resolution` cuando el control socket no responde devuelve 503.
- [ ] En modo server (`ROBOT_MODE=server`), `GET /api/config/camera/resolution` devuelve 404.

## Manual Checks

Camera worker en aislado (sin backend):

- [ ] Escribir `data/robot/camera_settings.json` con `{"preset": "720p"}` y arrancar `make run-camera` → log "Camera opened" reporta 2560×720.
- [ ] Mientras corre, mandar `{"cmd": "reload"}` al control socket (con `socat` o un script ad-hoc). Mientras se hace, sobrescribir el JSON a `{"preset": "1080p"}` antes del reload → log "Camera opened" reporta 3840×1080 y los clientes conectados se desconectan limpio.

End-to-end en Jetson:

- [ ] Operador en `/vision` desconectado → ve el selector de resolución con valor "1080p".
- [ ] Click en "Conectar" → live arranca a 1920×1080 (verificar con `about:webrtc`).
- [ ] Click en "Desconectar" → live para. Selector se vuelve interactivo otra vez.
- [ ] Cambiar selector a "720p" → toast "Resolución cambiada". Verificar que `data/robot/camera_settings.json` ahora dice `"720p"`.
- [ ] Click "Conectar" otra vez → live arranca a 1280×720 (verificar con `about:webrtc`, frame size = 1280×720).
- [ ] Iniciar grabación a 720p, detener → MP4 resultante es 1280×720 (`ffprobe data/robot/recordings/<uuid>.mp4`).
- [ ] Volver a "1080p", `make restart` simulando reboot → camera-worker arranca con 1080p (el JSON sobrevive el reinicio).
- [ ] Mientras hay sesión de conteo activa, intentar cambiar resolución → selector está disabled con tooltip explicativo.
- [ ] Mientras hay grabación activa, intentar cambiar resolución → selector está disabled.

Edge cases:

- [ ] Borrar `data/robot/camera_settings.json` y reiniciar el camera-worker → arranca en 1080p (default). El backend sigue respondiendo `GET /api/config/camera/resolution` → `"1080p"`.
- [ ] Modo server: `GET /api/config/camera/resolution` devuelve 404 (no aplica fuera del robot).

## Post-deploy Checks

- [ ] En Jetson real: `journalctl -u camera-worker | grep "Camera opened"` muestra el preset correcto al primer boot post-deploy.
- [ ] El primer operador del día que entra a `/vision` ve el selector y puede usar el robot sin abrir terminal.

## Known Caveat

Después de un cambio de preset y reconexión, el primer (a veces el segundo) live a 1080p puede negociar a ~16 fps en vez de 25. `sudo systemctl restart robot-platform` lo deja a 25 fps de nuevo. La hipótesis es cleanup tardío del `GstNvencEncoder` en `back/services/nvenc_codec.py` cuando aiortc destruye la peer connection — no es regresión de Phase 11 (se reproduce con disconnect/reconnect a secas), pero el flujo del selector lo hace visible. Tracker para una próxima fase: instrumentar el ciclo de vida del pipeline GST y forzar `set_state(NULL)` al cierre de la track en vez de depender de `__del__`.

## Rollback Criteria

Si después del deploy el camera-worker no arranca (loop de restart en systemd) o el live no negocia con el frontend, revertir el merge: el comportamiento previo (env vars en `.env.robot` + `make restart`) sigue funcionando porque el preset cargado del JSON sólo sobrescribe los env vars cuando el JSON existe.

## Definition of Done

Todas las cajas marcadas, branch rebased contra `master`, sin `console.log` o `print` de debug, y `camera_worker/README.md` + `recording_worker/README.md` reflejan el flujo nuevo (toggle frontend en vez de override de `.env.robot`).
