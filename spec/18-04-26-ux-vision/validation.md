# Validation: UX Vision

La fase está lista para mergear cuando el build de TypeScript es limpio y todos los checks manuales pasan.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores de TypeScript ni de build

## Manual Checks

**Endpoints backend:**
- [ ] `GET /api/config/available-labels` retorna las etiquetas de los modelos registrados en la DB
- [ ] `POST /api/config/select-label` con `{label: "arandano", model_filename: "best_yolo11n_arandano.pt"}` → worker carga el modelo (verificar en logs del worker)
- [ ] `POST /api/config/select-label` con worker caído → responde 503

**Flujo UI:**
- [ ] Navegar a `/vision` → ver grilla de tarjetas con las etiquetas disponibles, sin stream
- [ ] Tocar "arandano" → POST a `/api/config/select-label` → pasar a pantalla de operación con "Detectando: arandano"
- [ ] Tocar "person" → cargar yolo11n.pt → pasar a pantalla de operación con "Detectando: person"
- [ ] En pantalla de operación, botón "← Cambiar" visible y habilitado
- [ ] Click "← Cambiar" → volver a la grilla de selección
- [ ] Click "Conectar" → stream inicia con el modelo ya cargado
- [ ] Con stream activo, botón "← Cambiar" deshabilitado
- [ ] Iniciar conteo → conteo funciona para la clase seleccionada
- [ ] Intentar navegar a otra pantalla con cámara conectada → toast de advertencia

**Limpieza:**
- [ ] `ClassSelector.tsx` ya no existe en el repositorio

## Definition of Done

Build de TypeScript limpio, todos los checks manuales pasan, y `ClassSelector.tsx` eliminado del repositorio.
