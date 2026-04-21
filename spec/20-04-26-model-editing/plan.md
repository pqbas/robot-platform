# Plan: Model Editing

## Group 1: Backend — endpoint PATCH

1. Agregar endpoint `PATCH /api/detection-models/{uuid}` en
   `back/routes/admin_models.py`:
   - Parámetros `Form` opcionales: `version`, `class_mapping`, `epochs`,
     `map50`, `map50_95`, `precision`, `recall`, `dataset_size`, `notes`
   - Parámetro `file: UploadFile | None = File(None)` opcional
   - Si `file` viene: borrar el archivo viejo del disco si el nombre cambia,
     guardar el nuevo `.pt` en `config.storage.models_dir`, actualizar
     `filename` y `file_hash` en el modelo
   - Para cada campo Form que venga con valor (no `None`): actualizar el
     campo en el modelo ORM
   - Retorna `DetectionModelOut` con `_model_to_out(model)`
   - Seguir el mismo patrón de `upload_detection_model`: `Form(None)` para
     campos opcionales, `hashlib.sha256` para el hash

---

## Group 2: Frontend — API function

2. Agregar `updateModel(uuid, formData)` en
   `front/src/api/admin-models.ts`:
   - Misma implementación que `uploadDetectionModel` pero con
     `method: "PATCH"` y URL `/api/detection-models/${uuid}`
   - Retorna `Promise<DetectionModel>`

---

## Group 3: Frontend — dialog de edición

3. Crear `front/src/modules/admin/components/ModelEditDialog.tsx`:
   - Props: `model: DetectionModel`, `open: bool`, `onOpenChange`,
     `onSuccess`
   - Al abrir: pre-poblar todos los campos con los valores actuales del
     modelo (`model.version`, `model.class_mapping` serializado como JSON,
     etc.)
   - Campos editables: `version`, `class_mapping` (textarea JSON),
     `epochs`, `map50`, `map50_95`, `precision`, `recall`, `dataset_size`,
     `notes`
   - Sección "Reemplazar archivo" al final: `<Input type="file" accept=".pt">`
     opcional con texto aclaratorio "Dejar vacío para conservar el archivo actual"
   - Al guardar: construir `FormData` con solo los campos que tienen valor,
     incluir el archivo si fue seleccionado, llamar `updateModel(model.uuid, fd)`
   - Validar `class_mapping` como JSON antes de enviar (mismo patrón que
     `ModelUploadDialog`)
   - Reutilizar la estructura visual de `ModelUploadDialog.tsx`

---

## Group 4: Frontend — botón en ModelsPage

4. En `front/src/modules/admin/ModelsPage.tsx`:
   - Agregar estado `editingModel: DetectionModel | null`
   - Importar `ModelEditDialog`
   - En cada fila, agregar botón "Editar" antes de "Activar"/"Eliminar"
     que setea `editingModel = model`
   - Renderizar `<ModelEditDialog>` al final del componente con
     `onSuccess={load}`
