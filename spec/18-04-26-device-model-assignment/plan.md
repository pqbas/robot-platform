# Plan: Device-Model Assignment

## Group 1: DB — tabla de asignaciones (servidor)

1. Agregar modelo ORM `DeviceModel` en `back/models.py`:
   - `device_id: Mapped[str]` — FK a `devices.id`, parte de PK compuesta
   - `model_uuid: Mapped[str]` — FK a `detection_models.uuid`, parte de PK compuesta
   - `__tablename__ = "device_models"`

2. Crear migración `back/alembic/versions/005_device_models.py`:
   - `CREATE TABLE device_models (device_id TEXT, model_uuid TEXT, PRIMARY KEY (device_id, model_uuid))`
   - No datos de seed; las asignaciones las hace el admin manualmente

---

## Group 2: Backend servidor — endpoints de asignación y sync filtrado

3. Agregar en `back/routes/devices.py` dos endpoints:
   - `GET /api/devices/{device_id}/models` — retorna lista de `DetectionModel`
     asignados a ese dispositivo (JOIN `device_models`)
   - `PUT /api/devices/{device_id}/models` — body: `{model_uuids: list[str]}`;
     reemplaza todas las asignaciones del dispositivo en una transacción
     (delete donde device_id = X, luego insert de los nuevos)

4. Agregar dependency `get_device_or_none` en `back/services/auth.py`:
   - En server mode: llama `verify_device_key` y retorna el `Device`
   - En robot mode: retorna `None` (sin auth, sin filtro)
   - Tipo de retorno: `Device | None`

5. Modificar `GET /api/sync/models` en `back/routes/sync.py`:
   - Cambiar `dependencies=_device_dep` por `device: Device | None = Depends(get_device_or_none)`
   - Si `device` es `None` (robot mode): retorna todos los modelos activos (comportamiento actual)
   - Si `device` tiene valor (server mode): filtra por JOIN con `device_models`
     donde `device_id = device.id`
   - Agregar `class_mapping` y `notes` al dict retornado (el robot los necesita para el upsert)

---

## Group 3: Frontend servidor — UI de asignación

6. Agregar en `front/src/api/admin-devices.ts`:
   - `getDeviceModels(deviceId: string): Promise<DetectionModel[]>`
   - `setDeviceModels(deviceId: string, modelUuids: string[]): Promise<void>`

7. Crear `front/src/modules/admin/components/DeviceModelsDialog.tsx`:
   - Props: `device: Device`, `open: bool`, `onOpenChange`
   - Al abrir: `GET /api/admin/detection-models` (todos los modelos activos) +
     `GET /api/devices/{id}/models` (asignados actualmente)
   - Renderiza lista con `<Checkbox>` por modelo — marcado si está asignado
   - Botón "Guardar" → `PUT /api/devices/{id}/models` con los UUIDs marcados
   - Usa el tipo `DetectionModel` de `front/src/types/index.ts`

8. En `front/src/modules/admin/DevicesPage.tsx`:
   - Agregar estado `modelDialog: Device | null`
   - Agregar columna "Modelos" en `<TableHead>`
   - En cada fila agregar botón "Modelos" que setea `modelDialog = device`
   - Renderizar `<DeviceModelsDialog>` al final del componente

---

## Group 4: Robot — sync registra modelos en DB local

9. Modificar `back/services/sync_pull.py` → función `pull_models()`:
   - Importar `AsyncSessionLocal` y `DetectionModel` de `back.database` / `back.models`
   - Después de descargar cada modelo, hacer upsert en `detection_models` local:
     - Buscar por `filename`; si existe → actualizar `file_hash`, `class_mapping`,
       `version`, `notes`; si no → insertar con `uploaded_by = "sync"`, `is_active = False`
   - Al finalizar el loop, eliminar de la DB local los registros cuyo `filename`
     no esté en la lista recibida del servidor (modelos desasignados)
   - Usar `async with AsyncSessionLocal() as session:` — no recibir session como parámetro
     para no acoplar con el contexto de request
