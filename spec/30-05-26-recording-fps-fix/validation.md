# Validation: Recording FPS Fix

Listo para mergear cuando todos los checks a continuacion pasan.

## Automated Tests

- [ ] `cd recording_worker && uv run pytest tests/test_encoder_pts.py -v` exits 0
- [ ] `cd front && pnpm tsc --noEmit` exits 0 (sin cambios en frontend, confirmar sin regresiones)

### Specific test coverage required

- [ ] `PyAvEncoder` con `libx264`: 10 frames a 100ms → duracion del MP4 >= 0.9s

## Manual Checks

- [ ] Grabar una sesion de ~10 segundos en el robot: el archivo MP4 resultante tiene duracion >= 9s al abrirlo en un reproductor de video.
- [ ] Reproducir el video en `DetectionReplayDialog`: los bboxes del overlay coinciden visualmente con el movimiento en el video (sin desfase evidente).
- [ ] Grabar con inferencia activa (carga alta en Jetson): la duracion del MP4 sigue coincidiendo con el tiempo real de la sesion.

## Definition of Done

El MP4 grabado dura lo mismo que la sesion real (+/- 1s) y los bboxes del overlay se ven sincronizados con el video durante la reproduccion.
