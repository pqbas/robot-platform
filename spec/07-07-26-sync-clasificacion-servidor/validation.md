# Validation: Sync de clasificación de madurez robot → servidor

La fase está lista para mergear cuando todo lo siguiente pasa. El criterio
central: una grabación clasificada en el robot, tras sincronizar, muestra en la
web del **servidor** el mismo estado `done` + distribución + galería que en el
robot.

## Automated Tests

- [ ] `cd src/back && uv run ruff check` sale 0, sin errores de lint.
- [ ] `cd src/back && uv run pytest` sale 0, sin fallos.

### Specific test coverage required

- [ ] `receive_recordings` con un `SyncRecording(classification_status="done",
      classification_config=...)` inserta la fila con esos campos, y un re-push
      con `classification_status` distinto los hace **upsert** (no los ignora).
- [ ] `_classifications_need_upload(...)` devuelve `True` solo cuando
      `uploaded_at` no es None, el estado ∉ `{pending, classifying}` y
      `classifications_uploaded_at is None`; `False` en cada uno de los tres
      casos negativos.
- [ ] `transcribe_classifications(rec)` sobre un `{uuid}.classifications.jsonl`
      de prueba crea N `FruitCrop` + N `FruitClassification` con el `image_path`
      bajo `crops_dir_for(rec)`, y es idempotente (segunda corrida no duplica).

## Manual Checks

- [ ] Robot con una grabación clasificada (`classification_status='done'`, p.ej.
      re-contar `247bcedc` → clasifica) → forzar sync (botón de sesión o
      `POST /api/sync/push` + esperar el upload loop).
- [ ] En el **server**, `GET /api/recordings/{uuid}/classifications` responde
      `status:"done"` con `distribution` no vacía y `crops` con nombres de JPG.
- [ ] En el **server**, `GET /api/recordings/{uuid}/crops/{filename}` de un crop
      del payload responde `200 image/jpeg`; un `filename` con `..` o `/` → 400.
- [ ] En la web del **server**, abrir el modal "Clasificación" de esa sesión →
      se ve el tipo predominante, el bar chart de frecuencia por tipo y la
      galería — idéntico al robot.
- [ ] Re-clasificar en el robot → el poller pone ambos flags a NULL → siguiente
      sync re-empuja jsonl + crops → el server refleja la nueva distribución
      (idempotente, sin crops duplicados).
- [ ] Grabación con clasificación **en curso** (`classifying`) → el jsonl parcial
      **no** se sube (queda sucio) hasta que el estado pasa a `done`.
- [ ] Grabación de una categoría **sin** clasificador (`classification_status
      ='none'`) → no rompe el loop; sube metadata `none`, sin jsonl ni crops.

## Post-deploy Checks

- [ ] En el server .67, verificar que el `recordings_dir` recibió
      `{uuid}.classifications.jsonl` y el subdir `crops/{uuid}/*.jpg`, y que
      `make logs`/uvicorn no muestra errores del receiver.
- [ ] El sync de metadata (empresas/sesiones/recordings) sigue fluyendo — la
      clasificación nunca bloquea el MP4 ni la cola de metadata (un fallo de crop
      solo deja el flag sucio para reintento).

## Rollback Criteria

Revertir si el upload de clasificación bloquea o ahoga el sync de MP4/metadata en
el enlace del robot, o si el receiver corrompe filas `fruit_crops`/
`fruit_classifications` existentes en el server.

## Definition of Done

Todas las casillas anteriores marcadas; sin migración nueva (solo `022`); sin
código de depuración; el server muestra la clasificación sincronizada idéntica a
la del robot y un fallo de subida jamás bloquea el MP4/metadata.
