# Validation: Device-Model Assignment

La fase está lista para mergear cuando el build de TypeScript es limpio y todos
los checks manuales pasan.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores de TypeScript ni de build
- [ ] `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head` aplica sin errores

## Manual Checks

**Endpoints servidor:**
- [ ] `GET /api/devices/{id}/models` retorna `[]` para un dispositivo sin asignaciones
- [ ] `PUT /api/devices/{id}/models` con `{model_uuids: ["<uuid>"]}` → asigna el modelo
- [ ] `GET /api/devices/{id}/models` después del PUT → retorna el modelo asignado
- [ ] `PUT /api/devices/{id}/models` con `{model_uuids: []}` → elimina todas las asignaciones

**Sync filtrado (servidor):**
- [ ] Robot A con modelo X asignado: `GET /api/sync/models` con API key de A → retorna solo X
- [ ] Robot B sin asignaciones: `GET /api/sync/models` con API key de B → retorna `[]`
- [ ] La respuesta incluye `class_mapping` además de `uuid`, `filename`, `file_hash`, `version`

**Sync pull (robot):**
- [ ] Correr `make run-robot` con server disponible → los modelos asignados aparecen en `detection_models` de la DB local (verificar con `sqlite3 data/robot/robot.db "SELECT filename, class_mapping FROM detection_models;"`)
- [ ] Desasignar un modelo en el servidor y volver a correr sync → el registro desaparece de la DB local del robot
- [ ] `GET /api/config/available-labels` en el robot retorna las etiquetas del modelo asignado

**UI admin:**
- [ ] En `/admin/devices`, cada fila tiene botón "Modelos"
- [ ] Abrir dialog → ver lista de modelos activos con checkboxes
- [ ] Marcar un modelo y guardar → aparece marcado al reabrir el dialog
- [ ] Desmarcar todos y guardar → dialog reabierto muestra todos desmarcados

## Definition of Done

Build TypeScript limpio, migración 005 aplicada en server, los modelos asignados
a un robot son los únicos que aparecen en su `available-labels`, y el dialog de
asignación en el admin funciona correctamente.
