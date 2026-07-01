# Validation: Streaming YUYV sin conversión de color en CPU

Listo para mergear cuando todo lo siguiente pase.

## Automated Tests

- [ ] `cd src/back && uv run ruff check` sale 0 (archivos tocados: `camera.py`,
      `nvenc_codec.py`, `inference_client.py`).
- [ ] `cd src/back && uv run pytest` sale 0 sin fallos.
- [ ] Prototipo de pipeline HW pasa (sin `videoconvert` de CPU):
      ```
      gst-launch-1.0 -e videotestsrc num-buffers=30 \
        ! 'video/x-raw,format=YUY2,width=1920,height=1080,framerate=30/1' \
        ! nvvidconv ! 'video/x-raw(memory:NVMM),format=NV12' \
        ! nvv4l2h264enc ! fakesink
      ```
      entra en PLAYING y termina con EOS limpio (exit 0). *(Ya verificado en la
      investigación; re-correr tras cualquier cambio de caps.)*

### Specific test coverage required

- [ ] Round-trip PyAV `yuyv422`: `av.VideoFrame.from_ndarray(arr(H,W,2),
      "yuyv422").to_ndarray("yuyv422")` devuelve el mismo buffer `(H,W,2)` — el
      único punto PyAV-específico del cambio. Cubrir con un test unitario o un
      script de humo reproducible.
- [ ] `inference_client.analyze(frame_yuyv)` con `frame.shape==(H,W,2)` produce
      un JPEG decodificable a BGR (no lanza, `imencode` recibe 3 canales tras el
      `cvtColor`).
- [ ] camera-worker: con `CAP_PROP_CONVERT_RGB=0` ignorado por el driver, el
      worker **aborta con error** en vez de emitir BGR como si fuera YUYV
      (comportamiento del paso 1 del plan).

## Manual Checks

> Requieren `sudo jetson_clocks` y la cámara conectada. Medir CPU con la cámara
> libre → arrancar workers → abrir un cliente WebRTC.

- [ ] **Handshake:** conectar al socket y confirmar `channels == 2`, `width/height
      == 1920/1080`; el frame mide 4.15 MB (no 6.2 MB).
- [ ] **Stream en vivo:** abrir el stream en el navegador → video nítido, colores
      correctos (sin tinte verde/rosa que delataría un YUYV mal interpretado),
      sin congelamiento.
- [ ] **CPU baja (el objetivo):** con un solo cliente viendo el stream, comparar
      `systemctl show -p CPUUsageNSec` de `robot-platform` y `camera-worker`
      antes/después. Debe caer de forma clara (se eliminan dos conversiones de
      color; en la medición base eran ~72% y ~46% de un núcleo).
- [ ] **Sin hilos de `videoconvert` en el backend:** durante el stream, revisar
      que no aparezca la carga del `videoconvert` de CPU; el trabajo de color está
      en `nvvidconv`/VIC.
- [ ] **Inferencia en vivo (overlay):** iniciar una sesión de conteo → las cajas
      de detección siguen apareciendo alineadas sobre el video (la ruta
      YUYV→BGR→JPEG del inference-client funciona).
- [ ] **Grabación:** grabar una sesión → el MP4 resultante se reproduce, con
      colores correctos y misma nitidez que el stream (pipeline YUY2 del
      recording-worker OK).
- [ ] **Fallback dev (opcional, en laptop no-Jetson):** el stream sigue
      funcionando por la rama `libx264` (convierte YUYV→BGR solo ahí).

## Post-deploy Checks

- [ ] Tras `make deploy-robot` y reinicio de workers, el stream levanta y el uso
      de CPU en reposo-con-stream quedó por debajo del baseline previo.
- [ ] `make logs-camera` no muestra el error de "CONVERT_RGB ignorado".

## Rollback Criteria

Si el stream sale con colores incorrectos, el MP4 se corrompe, o `nvvidconv`
devuelve frames negros con `YUY2` en esta Jetson, revertir la rama (volver a
`format=BGR` + `videoconvert`) — es un cambio aislado al formato del socket y los
caps de dos pipelines.

## Definition of Done

Todas las casillas anteriores marcadas; el stream y la grabación funcionan a
1080p con colores correctos; el uso de CPU de `robot-platform` y `camera-worker`
bajó respecto al baseline medido; sin `videoconvert` de CPU en ninguno de los dos
pipelines de Jetson; rama rebaseada limpia sobre `master`.
