# Plan: UX Vision

## Group 1: Backend — endpoints de etiquetas y selección de modelo

1. Agregar endpoint `GET /api/config/available-labels` en `back/routes/config_routes.py`:
   - Consulta todos los modelos en la DB local (`SELECT * FROM detection_models`)
   - Parsea `class_mapping` (JSON) de cada modelo
   - Retorna lista de `{label: str, model_filename: str}`
   - Si un modelo no tiene `class_mapping`, se omite

2. Agregar endpoint `POST /api/config/select-label` en `back/routes/config_routes.py`:
   - Body: `{label: str, model_filename: str}`
   - Construye el path absoluto: `config.storage.models_dir / model_filename`
   - Llama `InferenceClient(config.perception.socket_path).reload_model(abs_path)`
   - Retorna `{ok: true, model: model_filename}`
   - Si el worker no está disponible, retorna error 503

3. Agregar schemas en `back/schemas.py`:
   - `AvailableLabelItem(label: str, model_filename: str)`
   - `SelectLabelRequest(label: str, model_filename: str)`

---

## Group 2: Frontend — componente ObjectPicker

4. Crear `front/src/modules/vision/components/ObjectPicker.tsx`:
   - Al montar: `GET /api/config/available-labels` → lista de etiquetas
   - Renderiza grilla de tarjetas (`grid grid-cols-2 gap-4`), una por etiqueta
   - Estado de carga mientras fetch
   - Al tocar una tarjeta: `POST /api/config/select-label` → si ok → llama `onSelect(label)`
   - Props: `onSelect: (label: string) => void`

5. Agregar función `getAvailableLabels()` y `selectLabel(label, modelFilename)` en
   `front/src/api/` (nuevo archivo `front/src/api/vision.ts`)

---

## Group 3: Refactor VisionPage

6. En `front/src/modules/vision/VisionPage.tsx`, agregar estado:
   ```ts
   const [step, setStep] = useState<"pick" | "operate">("pick")
   ```

7. Cuando `step === "pick"` → renderizar solo `<ObjectPicker onSelect={...} />` centrado,
   sin config bar, sin stream

8. Cuando `step === "operate"` → layout actual con estos cambios:
   - Eliminar `<ClassSelector>` de la config bar
   - Reemplazar por texto "Detectando: {selectedClass}"
   - Agregar botón "← Cambiar" a la izquierda, deshabilitado si `busy`
   - Al hacer click → `setStep("pick")`

---

## Group 4: Limpieza

9. Eliminar `front/src/modules/vision/components/ClassSelector.tsx`

10. Eliminar el import de `ClassSelector` en `VisionPage.tsx`
