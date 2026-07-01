# Validation: JPEG por hardware para la inferencia en vivo

Listo para mergear cuando todo lo siguiente pase.

## Automated Tests

- [ ] `cd src/back && uv run ruff check services/perception/jpeg_encoder.py
      services/perception/inference_client.py` sale 0.
- [ ] `PYTHONPATH=<repo>/src uv run pytest` (desde `src/back`) sale 0 sin fallos.
      *(El suite necesita `src` en el PYTHONPATH y correr sin los plugins pytest de
      ROS — ver la fase de streaming.)*

### Specific test coverage required

- [ ] `jpeg_encoder._cpu_encode(frame_yuyv)` con `shape==(H,W,2)` devuelve bytes
      de un JPEG que `cv2.imdecode` reconstruye a `(H,W,3)` BGR con los colores
      correctos.
- [ ] `jpeg_encoder._cpu_encode(frame_bgr)` con `shape==(H,W,3)` no re-convierte
      (imencode directo) y devuelve un JPEG válido.
- [ ] `make_jpeg_encoder()` devuelve `HwJpegEncoder` cuando `nvjpegenc` está
      presente y `CpuJpegEncoder` cuando no (mockear `_has_nvjpegenc`).
- [ ] Smoke HW (solo Jetson, marcar skip si no hay `nvjpegenc`):
      `HwJpegEncoder().encode(frame_yuyv)` produce un JPEG decodable a BGR con
      colores correctos — reproduce el prototipo
      `appsrc(YUY2)!nvvidconv!I420!nvjpegenc`.

## Manual Checks

> Requieren la cámara conectada y `sudo jetson_clocks`. La inferencia solo corre
> con una sesión de conteo activa.

- [ ] **Overlay correcto:** iniciar una sesión de conteo → las cajas de detección
      siguen apareciendo alineadas y con el mismo aspecto que antes (la ruta
      YUYV→I420→JPEG→worker preserva la imagen).
- [ ] **CPU baja durante la sesión:** comparar `CPUUsageNSec` de `robot-platform`
      con una sesión activa, antes/después del cambio. Debe caer el costo del
      `imencode` (~10-12 ms/frame de CPU a la tasa de inferencia); el streaming en
      sí no cambia.
- [ ] **Encoder HW elegido:** `make logs` del backend muestra que se instanció el
      encoder de hardware (`nvjpegenc`), no el fallback CPU, al primer frame de
      inferencia.
- [ ] **Sin fugas de pipeline:** iniciar y detener varias sesiones seguidas → no se
      acumulan pipelines GStreamer ni crece el uso de memoria del backend (el
      `close()` libera el encoder).
- [ ] **Fallback dev:** en laptop no-Jetson (sin `nvjpegenc`), una sesión de conteo
      sigue funcionando por la ruta `cv2` (overlay correcto).

## Rollback Criteria

Si el overlay sale con colores/posiciones incorrectas, el pipeline `nvjpegenc` es
inestable (cuelga o fuga memoria), o la latencia extra rompe el ritmo del overlay,
revertir `inference_client.detect()` a `cv2.cvtColor + cv2.imencode` — es un cambio
aislado detrás del factory `make_jpeg_encoder`.

## Definition of Done

Todas las casillas marcadas; el overlay de inferencia se ve igual que antes; el
uso de CPU del backend durante una sesión de conteo bajó respecto al baseline con
`cv2`; el `inference-worker` no se tocó; fallback `cv2` intacto para dev; rama
rebaseada limpia sobre `master`.
