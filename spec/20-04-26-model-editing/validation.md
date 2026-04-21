# Validation: Model Editing

La fase está lista para mergear cuando el build de TypeScript es limpio y
todos los checks manuales pasan.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores de TypeScript ni de build

## Manual Checks

**Editar metadatos:**
- [ ] Botón "Editar" visible en cada fila de `/admin/models`
- [ ] Al abrir el dialog, los campos están pre-poblados con los valores actuales
- [ ] Cambiar `version` y `notes` → guardar → la tabla refleja los nuevos valores
- [ ] Cambiar `class_mapping` con JSON inválido → error de validación, no se envía

**Reemplazar archivo:**
- [ ] Subir un nuevo `.pt` con distinto nombre → el modelo muestra el nuevo
  `filename` y el archivo viejo ya no existe en disco
- [ ] Subir un nuevo `.pt` con el mismo nombre → el archivo se sobreescribe,
  `file_hash` se actualiza en DB
- [ ] Dejar el campo de archivo vacío → solo se actualizan metadatos, el
  archivo en disco no cambia

**Integración con sync:**
- [ ] Después de reemplazar el archivo, el robot detecta el hash mismatch en
  el próximo ciclo de sync y descarga el nuevo `.pt`
  (verificar en logs del robot: `Sync pull: <filename> hash mismatch, downloading update`)

## Definition of Done

Build TypeScript limpio, los dos flujos (solo metadatos y reemplazo de archivo)
funcionan correctamente, y el archivo viejo no queda huérfano en disco al
cambiar el nombre.
