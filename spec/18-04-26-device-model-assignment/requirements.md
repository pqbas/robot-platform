# Requirements: Device-Model Assignment

## Scope

El AI engineer puede asignar desde el servidor qué modelos de detección tiene
permitido usar cada robot. El robot solo descarga y expone las etiquetas de los
modelos que le fueron asignados. Un robot sin asignaciones explícitas no recibe
ningún modelo.

Esta fase también cierra el gap actual en el sync: el robot descarga los `.pt`
pero nunca registra los modelos en su propia DB, por lo que `available-labels`
devuelve siempre vacío aunque los archivos existan localmente.

## Behavior

**Asignación (servidor — admin UI):**
- En la pantalla de Dispositivos, cada fila tiene un botón "Modelos asignados"
- Al abrirlo, aparece una lista de todos los modelos activos con checkboxes
- El admin marca los modelos permitidos para ese dispositivo y guarda
- Un dispositivo puede tener cero, uno o varios modelos asignados

**Sync pull (robot):**
- El endpoint `GET /api/sync/models` identifica al robot por su API key y
  retorna solo los modelos asignados a ese dispositivo (no todos los activos)
- El robot descarga los `.pt` nuevos o actualizados como hoy
- **Nuevo:** después de descargar, el robot registra (upsert) cada modelo en
  su tabla local `detection_models` con `filename`, `file_hash`, `class_mapping`
  y el resto de metadatos que el servidor devuelve
- Si un modelo ya no está en la lista del servidor (fue desasignado), el robot
  lo elimina de su DB local (el `.pt` en disco puede quedar; no se borra)

**available-labels (robot):**
- Sin cambios de interfaz: sigue leyendo `detection_models` local
- Funciona correctamente una vez que el sync registra los modelos en la DB

## Decisions

- **Tabla `device_models` en el servidor** — join table `(device_id TEXT,
  model_uuid TEXT)`, PK compuesta, sin timestamps. Sin restricciones de
  unicidad adicionales; la PK ya garantiza que no se dupliquen asignaciones.

- **`GET /api/sync/models` filtra por device** — el servidor extrae el
  `device_id` del API key verificado (ya disponible en `verify_device_key`) y
  hace JOIN con `device_models`. Si el dispositivo no tiene asignaciones,
  retorna `[]`.

- **Upsert en el robot** — el robot usa `INSERT OR REPLACE` (SQLite) sobre
  `detection_models` indexado por `filename`. Si el archivo ya existe con el
  mismo hash, actualiza igual los metadatos (class_mapping puede cambiar sin
  que cambie el .pt). El campo `uploaded_by` se fija a `"sync"`.

- **Desasignación → eliminar de DB local** — el robot compara la lista
  recibida con su DB local y elimina los registros que ya no están. El `.pt`
  en disco no se toca para evitar pérdida accidental de archivos grandes.

- **`is_active` en el robot** — todos los modelos sincronizados llegan como
  `is_active = False` en la DB local del robot. El campo `is_active` del robot
  no se usa: la selección de modelo la hace el operador desde `ObjectPicker`,
  no un flag automático.

- **Compatibilidad con el flujo actual** — `InferenceClient.reload_model` y
  `ObjectPicker` no cambian. El único cambio observable para el operador es
  que la grilla de etiquetas muestra solo las del modelo asignado a ese robot.

## Context

- `spec/roadmap.md` — Phase 4, ítem "El AI engineer puede asignar modelos a
  robots desde el servidor".
- `back/services/sync_pull.py` — aquí se agrega el upsert en DB local.
- `back/routes/sync.py` — aquí se filtra `GET /api/sync/models` por device.
- `back/routes/devices.py` — aquí se agregan los endpoints de asignación.
- `front/src/modules/admin/DevicesPage.tsx` — aquí se agrega el botón y el
  dialog de asignación.
