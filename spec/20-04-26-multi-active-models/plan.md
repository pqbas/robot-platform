# Plan: Multi-Active Models

## Group 1: Backend

1. En `back/routes/admin_models.py`, función `activate_model`:
   - Eliminar el bloque que consulta y desactiva los demás modelos activos
     (las líneas con `select(DetectionModel).where(DetectionModel.uuid != uuid, ...)`)
   - Dejar solo `model.is_active = True`, commit y refresh

2. En el mismo archivo, agregar endpoint `deactivate_model`:
   ```
   @router.put("/detection-models/{uuid}/deactivate", response_model=DetectionModelOut)
   async def deactivate_model(uuid, db, _):
       # fetch model, 404 si no existe
       model.is_active = False
       commit, refresh, return _model_to_out(model)
   ```
   Seguir el mismo patrón que `activate_model` (mismas dependencias, mismo retorno).

---

## Group 2: Frontend API

3. En `front/src/api/admin-models.ts`, agregar:
   ```ts
   export function deactivateModel(uuid: string) {
     return apiFetch<DetectionModel>(`/api/detection-models/${uuid}/deactivate`, {
       method: "PUT",
     })
   }
   ```
   Mismo patrón que `activateModel`.

---

## Group 3: Frontend UI

4. En `front/src/modules/admin/ModelsPage.tsx`:
   - Importar `deactivateModel` desde `@/api/admin-models`
   - Agregar `handleDeactivate(uuid)` igual que `handleActivate` pero llamando
     `deactivateModel`
   - En cada fila, reemplazar el condicional `{!model.is_active && <Button>Activar</Button>}`
     por dos botones mutuamente excluyentes:
     - Si `!model.is_active` → botón "Activar"
     - Si `model.is_active` → botón "Desactivar"
