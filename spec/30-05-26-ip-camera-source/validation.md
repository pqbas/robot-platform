# Validation: IP camera source (RTSP)

La fase esta lista para merge cuando todos los puntos siguientes pasan.

## Automated Tests

- [ ] `cd camera_worker && uv run python -c "from camera_worker.main import parse_args, open_camera; print('OK')"` — importa sin errores
- [ ] `cd front && pnpm tsc --noEmit` — sin errores de tipos (el frontend no cambia; verificacion de regresion)

## Automated Tests (adicionales)

- [ ] `cd back && uv run python -c "from back.services.camera_settings import read_rtsp_url, write_rtsp_url; print('OK')"` — importa sin errores

## Manual Checks

- [ ] Iniciar el worker apuntando a una camara IP real: `CAMERA_RTSP_URL=rtsp://<ip>:<port>/stream uv run camera-worker` — el log muestra `Camera opened (rtsp=...)` con width/height/fps reales.
- [ ] Iniciar el worker con `--rtsp-url rtsp://<ip>:<port>/stream` (flag CLI) — mismo resultado que la variable de entorno.
- [ ] Con el worker corriendo en modo RTSP, arrancar el backend y abrir `/vision` en el navegador — el stream se muestra correctamente.
- [ ] Configurar `rtsp_url` en `data/robot/camera_settings.json` y arrancar el worker sin flags — el log confirma que tomo la URL del JSON.
- [ ] Enviar `{"cmd": "reload"}` al control socket con el worker en modo RTSP — el worker cierra y reabre el VideoCapture RTSP; los clientes reconectan.
- [ ] Arrancar el worker con una URL RTSP invalida o un servidor apagado — el worker reintenta cada 1 s sin crashear (mismo comportamiento que V4L2 desconectada).
- [ ] Arrancar el worker sin `--rtsp-url` y sin `rtsp_url` en el JSON — el comportamiento V4L2 es identico al de antes de esta fase (regresion).

- [ ] Abrir Settings en el frontend (robot mode) — aparece campo "Fuente de video" en la seccion Camara.
- [ ] Ingresar una URL RTSP en el campo y guardar — `PUT /api/config/camera/source` responde 200, el worker recibe `reload` y reconecta con la nueva URL.
- [ ] Dejar el campo vacio y guardar — el worker vuelve a usar V4L2 (o mantiene la URL anterior si no se borra el JSON; especificar comportamiento esperado).
- [ ] En server mode, el campo "Fuente de video" no aparece.

## Definition of Done

Todos los checks manuales pasan con una camara IP real en la LAN. El modo V4L2 no tiene regresiones al arrancar sin `CAMERA_RTSP_URL`.
