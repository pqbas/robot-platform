# Validation: WebRTC live a H.264 NVENC sin caveat

Implementación lista para mergear cuando todas las cajas siguientes pasan.

## Automated Tests

- [ ] `cd back && uv run pytest` exits 0 (sin regresión).
- [ ] `cd front && npx tsc --noEmit` exits 0.
- [ ] `cd back && uv run python -c "from back.services.nvenc_codec import detect_backend, GstNvencEncoder, PyAvNvencEncoder; print(detect_backend())"` imports sin error e imprime un backend válido (`h264_nvenc`, `nvv4l2h264enc`, o `libx264` según el host).
- [ ] `cd back && uv run python -c "from back.services.nvenc_init import init_nvenc; init_nvenc()"` no raisea en laptop dev (loggea fallback a libx264 y retorna).

### Specific test coverage required

Esta phase no agrega rutas, schema, ni código puro de fácil unit-test (la lógica relevante está dentro de un pipeline GStreamer que requiere hardware NVIDIA + cámara real para verificarse). Las verificaciones críticas son manuales en Jetson y están en la sección "Manual Checks". No se requieren archivos nuevos en `back/tests/`.

## Manual Checks

### Backend boot en Jetson (post-`make restart`)

- [ ] `systemctl status robot-platform` → active (running), sin errores en startup.
- [ ] `journalctl -u robot-platform -n 100 --no-pager | grep -i nvenc` muestra:
  - `aiortc H264Encoder patched → GstNvencEncoder (nvv4l2h264enc)`.
  - `aiortc video codec preferences after patch: ['video/H264']` (lista sin VP8).
- [ ] `journalctl -u robot-platform -n 100 --no-pager | grep -i "GStreamer pipeline ready"` aparece la primera vez que un peer connection se abre, con `nvv4l2h264enc (1920x1080 @ N kbps)`.
- [ ] `journalctl -u robot-platform -n 100 --no-pager | grep -i "WebRTC H264 encoder live"` aparece una vez por peer connection con la resolución y backend correctos.

### Cliente WebRTC en Firefox (validación principal del caveat)

- [ ] Abrir el stream desde Firefox en una laptop conectada a la misma red local del Jetson.
- [ ] `about:webrtc` → seleccionar el peer connection activo → "Statistics" → "RTP Stats inbound video":
  - `codec` reporta `H264` (no `VP8` ni `VP9`).
  - `frameWidth=1920`, `frameHeight=1080`.
  - `framesPerSecond` ≥ 25 (target 30 ± 5 según condiciones de red).
  - `framesDropped` = 0 ó muy bajo (< 1% del total).
  - `packetsLost` = 0 ó < 0.1%.
  - `nackCount`, `pliCount`, `firCount` cercanos a 0 (señal de que el cliente no está pidiendo retransmisiones).
- [ ] Latencia visual: gesto frente a la cámara → aparición en pantalla < 500 ms (comparable o mejor al modo 720p de Phase 8).

### Cliente WebRTC en Chrome (cross-check)

- [ ] Mismo stream desde Chrome sobre la misma red local.
- [ ] `chrome://webrtc-internals/` → `inbound-rtp (kind=video)`:
  - `[codec]` = `H264 (level-asymmetry-allowed=1;packetization-mode=1)`.
  - `[framesPerSecond]` ≥ 25.
  - `[framesDecoded/s]` ≈ `framesPerSecond`.
  - `[bytesReceived/s]` consistente con bitrate esperado (~1-2 Mbps para 1080p WebRTC adaptativo, no debe colapsar a 200 kbps como en el caveat).

### Coexistencia live + recording (regresión cero)

- [ ] Iniciar grabación desde la UI mientras el live está corriendo a 1080p en el browser.
- [ ] El log `Recording started uuid=… backend=nvv4l2h264enc out=… 1920x1080 @ 30.0fps bitrate=12000000` aparece en `journalctl -u recording-worker`.
- [ ] El live no degrada (FPS sigue en `about:webrtc` ≥ 25 durante la grabación).
- [ ] `tegrastats` durante live + grabación 1080p simultáneos:
  - NVENC en uso (no idle) y bajo 100% sostenido.
  - CPU del backend < 60% de un core (regresión: si pasa de 80% es peor que antes).
  - YOLO FPS reportado en `VisionPage` no cae más de 2 FPS comparado con sólo live (medir en la misma escena).
- [ ] Detener grabación, verificar que el archivo MP4 reproduce correctamente en VLC y `ffprobe` reporta `width=1920 height=1080 codec_name=h264 profile=High`.

### Modo 720p (no regresiona)

- [ ] Editar `.env.robot` con override `CAMERA_WIDTH=2560 CAMERA_HEIGHT=720 CAMERA_CROP=1280`, `make restart`.
- [ ] El live a 1280×720 sigue funcionando (`framesPerSecond` ≥ 28, `codec=H264`).
- [ ] Revertir a defaults, `make restart`, validar que el switch es bidireccional sin side effects.

### Logs cuentan la historia (diagnóstico futuro)

- [ ] `journalctl -u robot-platform | grep -E "H264Encoder patched|video codec preferences|WebRTC H264 encoder live"` produce salida ordenada y útil para reconstruir qué codec/encoder se usó si en el futuro alguien reporta lag.

## Post-deploy Checks

- [ ] Tras 30 min de stream continuo (sesión real del operador): `journalctl -u robot-platform | grep -i "ERROR\|appsrc push-buffer"` vacío. Si hay `appsrc push-buffer returned ...`, los frames se están atorando — abortar y revisar.
- [ ] Una grabación 1080p hecha durante el periodo de testing llega al server vía sync, se descarga y `ffprobe` muestra `1920×1080 / 12 Mbps / High` íntegro (path WebRTC live no afecta el path recording).

## Rollback Criteria

Hacer rollback si:
- (a) En Jetson, después del despliegue, el peer connection ni siquiera negocia (Firefox/Chrome se quedan en "connecting...") porque el monkey-patch removió VP8 pero el H264 path falla — síntoma: no aparece `WebRTC H264 encoder live` en logs y el frontend reporta error de WebRTC.
- (b) `tegrastats` muestra NVENC al 100% sostenido durante el live solo (sin grabación) y aparecen `appsrc push-buffer returned ...` en logs (NVMM bridge agregó congestión inesperada).
- (c) Detección YOLO degrada > 5 FPS comparado con pre-Phase 10 (señal de contención de bus de memoria).

Rollback rápido: revert del PR. La phase es aditiva sobre código existente; revert reinstala el pipeline pre-fix y vuelve al caveat documentado de Phase 9 (que tiene su propio workaround vía `.env.robot` 720p).

## Definition of Done

Todas las cajas arriba marcadas, branch rebaseado contra `master` sin conflictos, sin `print` de debug ni TODOs nuevos. El caveat de Phase 9 cerrado en `spec/roadmap.md` (Phase 9 marcada `(Complete)`, caja 3 marcada `[x]` apuntando a esta phase). Los READMEs de `camera_worker` y `recording_worker` ya no recomiendan el override 720p como medida default; lo dejan como troubleshooting de red. El operador puede usar el robot con defaults sin instrucciones especiales.
