# Plan: Frontend de visualización de clasificación de madurez

## Group 1: Backend — prerequisitos mínimos

1. Servir el JPG del recorte en `src/back/routes/recordings.py` (nuevo endpoint,
   espejo de `download_recording` en `:284`):
   - `GET /{uuid}/crops/{filename}` → `FileResponse(path, media_type="image/jpeg")`.
   - Resolver el directorio con
     `back.services.perception.classification_trigger.crops_dir_for(rec)` (o
     recomponer `os.path.join(os.path.dirname(rec.file_path), "crops", uuid)`).
   - Validar `filename` contra path traversal: rechazar si contiene `/`, `\` o
     `..`; 404 si el archivo no existe. 404 si la grabación no existe.

2. Exponer `classification_status` a nivel de sesión:
   - `src/back/schemas.py` — en `SessionOut` (`:56`, junto a `count_status`)
     agregar `classification_status: str = "none"`.
   - `src/back/services/storage.py` — en `_attach_count_status` (`:247`) agregar
     `s.classification_status = rec.classification_status if rec else "none"`
     (el `Recording` ya está cargado en `by_uuid`).

---

## Group 2: Frontend — tipos y cliente de API

3. `src/front/src/types/index.ts`:
   - Agregar `export type ClassificationStatus = "none" | "classifying" | "done" | "error"`
     (junto a `CountStatus` en `:20`).
   - En `Session` (`:22`) agregar `classification_status: ClassificationStatus`.
   - Agregar los tipos de la respuesta de clasificación:
     ```ts
     export type RipenessCrop = {
       track_id: number
       label: string | null
       confidence: number | null
       bbox: [number, number, number, number]
       crop: string
     }
     export type RecordingClassifications = {
       status: ClassificationStatus
       error: string | null
       distribution: Record<string, number>
       crops: RipenessCrop[]
     }
     ```

4. `src/front/src/api/recordings.ts` (mismo estilo que las funciones existentes):
   - `getRecordingClassifications(uuid): Promise<RecordingClassifications>` →
     `GET /api/recordings/${uuid}/classifications`.
   - `reclassifyRecording(uuid): Promise<Recording>` →
     `POST /api/recordings/${uuid}/reclassify`.
   - `getCropImageUrl(uuid, filename): string` →
     `` `/api/recordings/${uuid}/crops/${encodeURIComponent(filename)}` `` (espejo
     de `getRecordingFileUrl` en `:87`).

---

## Group 3: Frontend — indicador en la tabla de sesiones

5. `src/front/src/modules/map/components/SessionsTable.tsx`:
   - Añadir columna "Madurez" al `TableHeader` (`:120`), oculta en pantallas
     chicas: `<TableHead className="hidden lg:table-cell">Madurez</TableHead>`.
   - Añadir la celda correspondiente (espejo de la celda "Conteo" en `:164`),
     dirigida por `s.classification_status`:
     - `classifying` → spinner + "clasificando…" (reusar `Loader2` ya importado).
     - `done` → `<Badge variant="outline">madurez ✓</Badge>`.
     - `error` → `<span className="text-xs text-destructive" title=...>error</span>`.
     - `none` → `<span className="text-muted-foreground">—</span>` (silencioso).

---

## Group 4: Frontend — sección "Madurez" en el detalle

6. Crear `src/front/src/modules/map/components/RipenessSection.tsx`:
   - Props: `{ recordingUuid: string; mode: "robot" | "server" }`.
   - Estado: `data: RecordingClassifications | null`, `loading`, `reclassifying`.
   - `useEffect` al montar / cambiar `recordingUuid`: `getRecordingClassifications`
     (patrón de fetch perezoso como en `DetectionReplayDialog`). Ignorar/limpiar
     en cleanup para evitar setState tras desmontar.
   - Render por estado:
     - `loading` → spinner.
     - `status === "classifying"` → spinner + "Clasificando madurez…".
     - `status === "error"` → mensaje con `data.error`.
     - `status === "none"` o `crops.length === 0` → **retornar `null`** (no
       renderiza la sección; no ocupa espacio en sesiones no clasificadas).
     - `status === "done"` con crops → distribución + galería (pasos 7–8).

7. Distribución (dentro de `RipenessSection`):
   - Total = suma de `Object.values(distribution)`.
   - Una fila por clase: nombre + conteo + `%`, y una barra horizontal
     (`<div>` con `style={{ width: \`${pct}%\` }}`) coloreada por clase.
   - Color por clase: helper local `colorForLabel(label, index)` con una paleta
     determinista (sin depender de nombres concretos). Sin nueva dependencia.

8. Galería (dentro de `RipenessSection`):
   - Grid responsivo de miniaturas; cada item:
     `<img src={getCropImageUrl(recordingUuid, c.crop)} loading="lazy" />` con
     `width/height` fijos y `object-cover`.
   - Debajo/encima: `c.label` + `Math.round((c.confidence ?? 0) * 100)%`.
   - Si son muchas, limitar el render inicial (p. ej. primeras 60) con un botón
     "ver todas" — evita meter cientos de `<img>` de golpe.

9. Botón "Re-clasificar" (solo `mode === "robot"`):
   - Llama `reclassifyRecording(recordingUuid)`; en éxito toast + re-fetch de
     `getRecordingClassifications`; en error toast con el mensaje del backend
     (409 → "La categoría no tiene un clasificador asignado", etc.).
   - Deshabilitado mientras `status === "classifying"` o `reclassifying`.

10. Integrar en `src/front/src/modules/map/components/SessionDetail.tsx`:
    - Debajo del grid de datos (`:78`), si `session.recording_uuid != null`,
      renderizar `<RipenessSection recordingUuid={session.recording_uuid} mode={mode} />`.
    - `mode` viene de `useAppMode()` (mismo hook que usa `SessionsTable`); si
      `SessionDetail` no lo tiene aún, importarlo.

---

## Group 5: Validación

11. `cd src/front && npx tsc --noEmit` → 0 errores.
12. `cd src/back && uv run ruff check` → limpio en los archivos tocados.
13. `PYTHONPATH=src uv run pytest` (desde `src/back`) → sin regresiones; agregar
    test del endpoint de crops (200 sirve el archivo; 404 inexistente; 400/404 en
    filename con `..`).
14. Checks manuales del `validation.md`.
