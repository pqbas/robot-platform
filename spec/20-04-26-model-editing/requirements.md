# Requirements: Model Editing

## Scope

El AI engineer puede editar los metadatos de un modelo ya registrado y
reemplazar su archivo `.pt` sin tener que eliminarlo y volver a subirlo.
Upload, activate y delete ya existen; esta fase agrega solo las dos
operaciones que faltan.

## Behavior

**Editar metadatos:**
- Botón "Editar" en cada fila de `/admin/models`
- Abre un dialog pre-poblado con los campos actuales del modelo
- Campos editables: `version`, `class_mapping`, `epochs`, `map50`,
  `map50_95`, `precision`, `recall`, `dataset_size`, `notes`
- Campos no editables: `filename`, `uuid`, `uploaded_by`, `created_at`
- Al guardar: `PATCH /api/detection-models/{uuid}` actualiza solo los
  campos enviados; el archivo en disco no se toca

**Reemplazar archivo:**
- Dentro del mismo dialog de edición, sección opcional "Reemplazar archivo"
- El admin selecciona un nuevo `.pt`; el nombre del archivo puede cambiar
- Al guardar con archivo: el backend sobreescribe el `.pt` en disco,
  actualiza `filename` y `file_hash` en DB
- Los robots asignados recibirán el nuevo archivo en el próximo ciclo de sync
  (no se dispara sync activo; el robot lo detecta por hash mismatch)

## Decisions

- **Un solo dialog para ambas operaciones** — editar metadatos y reemplazar
  archivo se hacen desde el mismo formulario para evitar flujos paralelos
  que puedan dejar el modelo en estado inconsistente (metadatos nuevos con
  archivo viejo o viceversa).

- **`PATCH` con `multipart/form-data`** — reutiliza el mismo estilo de
  `POST /api/detection-models` (Form + File opcional). El archivo es
  opcional; si no se envía, solo se actualizan metadatos.

- **El nombre de archivo puede cambiar** — si el admin sube un `.pt` con
  distinto nombre, el backend borra el archivo viejo del disco y guarda el
  nuevo. Esto evita archivos huérfanos.

- **`uploaded_by` no se edita** — representa quién creó el registro
  originalmente. Los cambios posteriores no se atribuyen.

- **Sin invalidación activa de robots** — no se envía señal push a los
  robots; el hash mismatch en el próximo ciclo de sync (cada 30s) es
  suficiente para el caso de uso actual.

## Context

- `back/routes/admin_models.py` — aquí se agrega el endpoint `PATCH`
- `front/src/modules/admin/components/ModelUploadDialog.tsx` — base para
  el nuevo `ModelEditDialog.tsx`; mismos campos, sin file obligatorio
- `front/src/modules/admin/ModelsPage.tsx` — aquí se agrega el botón
  "Editar" y se renderiza el nuevo dialog
- `front/src/api/admin-models.ts` — aquí se agrega `updateModel()`
