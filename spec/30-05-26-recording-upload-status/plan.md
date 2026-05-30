# Plan: Indicador de estado de upload en grabaciones

## Group 1: Backend — estado en memoria

1. En `back/services/sync_recordings_upload.py`, agregar variable de módulo:
   ```python
   _uploading_uuids: set[str] = set()
   ```

2. En `_upload_one`, envolver la operación para actualizar el conjunto:
   - Al inicio: `_uploading_uuids.add(row.uuid)`
   - En el bloque `finally` (antes de `return`): `_uploading_uuids.discard(row.uuid)`
   - Requiere reestructurar el try/except actual en try/finally o agregar `finally`.

3. Agregar función pública para leer el estado:
   ```python
   def get_uploading_uuids() -> list[str]:
       return list(_uploading_uuids)
   ```

---

## Group 2: Backend — endpoint

4. En `back/routes/recordings.py`, importar `get_uploading_uuids` desde `back.services.sync_recordings_upload`.

5. Agregar endpoint:
   ```python
   @router.get("/uploading")
   async def uploading_uuids():
       return {"uuids": get_uploading_uuids()}
   ```
   Ubicar antes del endpoint `GET /{uuid}/file` para que el router no interprete "uploading" como un UUID.

---

## Group 3: Frontend

6. En `front/src/api/recordings.ts`, agregar:
   ```typescript
   export function getUploadingUuids(): Promise<{ uuids: string[] }> {
     return apiFetch("/api/recordings/uploading")
   }
   ```

7. En `front/src/modules/recordings/RecordingsPage.tsx`:
   - Agregar `"uploading"` a `RowStatus`.
   - En `rowStatus(rec, uploadingSet)`: si `rec.uuid` está en `uploadingSet` y `rec.uploaded_at == null`, devolver `"uploading"`.
   - En `StatusBadge`: agregar case `"uploading"` con badge amarillo/outline, texto `subiendo`.
   - Agregar estado `const [uploadingUuids, setUploadingUuids] = useState<Set<string>>(new Set())`.
   - Agregar `useEffect` con `setInterval` de 3000ms que llama `getUploadingUuids()` y actualiza el estado. Limpiar el interval en el return del efecto.
   - Pasar `uploadingUuids` a `rowStatus` en el render de cada fila.
