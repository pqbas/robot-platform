# Validation: Detection Log

Listo para mergear cuando todos los checks a continuación pasan.

## Automated Tests

- [ ] `cd front && pnpm tsc --noEmit` exits 0 (no cambios en frontend, pero confirmar sin regresiones)

### Specific test coverage required

- [ ] `detection_recorder.start(uuid, dir)` crea el archivo `{dir}/{uuid}.jsonl`
- [ ] `detection_recorder.record(detections)` escribe una línea JSON válida con los campos `frame`, `t`, `dets`
- [ ] `detection_recorder.record([])` escribe una línea con `dets: []` y avanza el contador de frame
- [ ] `detection_recorder.stop()` cierra el archivo; llamadas a `record()` posteriores son no-ops
- [ ] `detection_recorder.start()` llamado dos veces sobreescribe el archivo y resetea el contador

## Manual Checks

- [ ] Iniciar grabación sin sesión de conteo activa: el inference worker corre (visible en logs `Inference: N detections`).
- [ ] Al detener la grabación: existe `data/robot/recordings/{uuid}.jsonl` con al menos una línea.
- [ ] Abrir el JSONL: cada línea es JSON válido con `frame` incremental (0, 1, 2, ...), `t` float, `dets` array.
- [ ] Si hay objetos en cámara durante la grabación: `dets` contiene entries con `cls`, `conf`, `bbox` y `track_id`.
- [ ] Iniciar grabación Y sesión de conteo simultáneamente: el conteo sigue funcionando correctamente y el JSONL también se genera.
- [ ] Detener grabación y reiniciar una nueva: el nuevo JSONL empieza con `frame: 0` y el archivo anterior se conserva.

## Definition of Done

Todos los checks manuales pasan en el robot. El archivo JSONL generado tiene frames con índice continuo y las detecciones corresponden visualmente a lo que se ve en el stream durante la grabación.
