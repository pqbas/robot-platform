# Validation: Session Detection Replay

Listo para mergear cuando todos los checks a continuacion pasan.

## Automated Tests

- [ ] `cd front && pnpm tsc --noEmit` exits 0 (sin errores de tipos en los nuevos componentes y campos)

## Manual Checks

- [ ] Guardar una sesion de conteo que tenia grabacion activa: la fila en la tabla de sesiones muestra el icono de video.
- [ ] Guardar una sesion de conteo que NO tenia grabacion (escenario de borde): la fila no muestra el icono de video.
- [ ] Hacer clic en el icono de video: se abre el popup con el video reproduciendose.
- [ ] Durante la reproduccion: los bounding boxes aparecen superpuestos sobre el video, sincronizados con el frame actual.
- [ ] Pausar el video: los bboxes del ultimo frame quedan pintados y no desaparecen.
- [ ] Arrastrar el scrubber a otro punto del video: los bboxes se actualizan al frame correspondiente.
- [ ] Frame sin detecciones (por ejemplo, parte del video sin objetos): el canvas queda limpio (sin bboxes).
- [ ] Cerrar el popup y reabrirlo: el video comienza desde el principio sin errores.
- [ ] Sesion sincronizada al servidor: el icono de video aparece en la vista del servidor y el popup reproduce el video correctamente.

## Definition of Done

Todos los checks manuales pasan en el robot con una sesion real grabada. El video se reproduce con los bboxes superpuestos sin desfase visual perceptible entre la posicion del scrubber y las detecciones mostradas.
