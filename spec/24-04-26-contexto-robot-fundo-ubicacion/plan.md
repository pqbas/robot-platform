# Plan: Contexto del robot — fundo + ubicación

## Group 1: Backend — schema y migración

1. Añadir `fundo_uuid` a `Device` en `back/models.py`:
   - Después del campo `last_sync_at` (línea 83):
     ```python
     fundo_uuid: Mapped[str | None] = mapped_column(
         ForeignKey("fundos.uuid"), nullable=True
     )
     fundo: Mapped["Fundo | None"] = relationship()
     ```

2. Crear `back/alembic/versions/007_device_fundo.py` siguiendo el patrón de `006_library_models.py`:
   - `op.batch_alter_table("devices")` con `batch_op.add_column(sa.Column("fundo_uuid", sa.Text(), sa.ForeignKey("fundos.uuid"), nullable=True))`
   - `down_revision = "006_library_models"`, `revision = "007_device_fundo"`
   - Downgrade: `batch_op.drop_column("fundo_uuid")`

---

## Group 2: Backend — admin endpoint para asignar fundo

3. Extender `DeviceUpdate` en `back/routes/devices.py` (línea 36) para aceptar `fundo_uuid: str | None = None`. Propagarlo en `update_device` (línea 117) — `if body.fundo_uuid is not None: device.fundo_uuid = body.fundo_uuid` (cuidado: distinguir "no enviado" de "enviado null"; usar pydantic `Field(default=...)` con sentinel o cambiar a `dict(exclude_unset=True)`).

4. Extender `DeviceOut` (línea 40) con `fundo_uuid: str | None`.

5. Añadir endpoint `GET /api/devices/{id}/context` en `back/routes/devices.py` que devuelve `{empresa, fundo}` resolviendo el join (admin only). Útil para debug — no es la fuente que consume el robot.

---

## Group 3: Backend — endpoint sync para que el robot lea su contexto

6. Añadir `GET /api/sync/device-context` en `back/routes/sync.py`:
   - Usa `Depends(get_device_or_none)` igual que `list_models` (línea 92).
   - Si device es null y modo SERVER: 401. Si modo ROBOT (sin auth): devolver `{device_id: config.device.id, fundo: null, empresa: null}` (modo lab).
   - Server mode: si `device.fundo_uuid` es null → fundo y empresa null. Si no, hacer join `Fundo` → `Empresa` y devolver ambos serializados.
   - Actualizar `device.last_sync_at` igual que `list_models`.

---

## Group 4: Backend — robot consume y cachea contexto

7. Crear `back/services/sync_pull_context.py`:
   - Función `pull_device_context() -> dict | None` que llama `GET /api/sync/device-context` (mismo patrón de auth que `sync_pull.py`).
   - Persistir el resultado en un archivo JSON local en `data/robot/device_context.json` (path nuevo en `config.storage`). Si server cae, se mantiene el último valor.
   - Manejar excepciones igual que `pull_models` (log warning, no crash).

8. Añadir `device_context_path` a `back/config.py` (donde están los otros paths de storage).

9. Llamar `pull_device_context()` desde `back/services/sync_loop.py` (donde ya corre `pull_models`) en cada iteración del loop.

10. Añadir endpoint `GET /api/device-context` (sin prefijo `/sync`) en `back/routes/sync.py` (o crear un módulo nuevo `back/routes/device_context.py` si crece) que devuelve el contenido cacheado del JSON local. Esto es lo que consume el frontend del robot.
    - En modo SERVER: este endpoint no aplica (devolver 404 o omitir el route registration).
    - En modo ROBOT: lee el archivo, devuelve `{empresa, fundo}` o `{empresa: null, fundo: null}` si no existe.

---

## Group 5: Backend — camellones heredan fundo del device

11. En `back/routes/camellones.py:create_camellon` (línea 27), antes de llamar `storage.create_camellon`:
    - Modo ROBOT: leer `data/robot/device_context.json`. Si existe `fundo.uuid`, pasarlo a `storage.create_camellon` como argumento adicional.
    - Modo SERVER: el endpoint sigue como está (los camellones del server vienen vía sync).

12. Extender `back/services/storage.py:create_camellon` para aceptar un `fundo_uuid: str | None = None` opcional y setearlo en el `Camellon` que crea.

---

## Group 6: Frontend — types y APIs

13. Extender `Device` en `front/src/types/index.ts` (línea 122) con `fundo_uuid: string | null`.

14. Añadir tipo `DeviceContext` en `front/src/types/index.ts`:
    ```ts
    export type DeviceContext = {
      empresa: { uuid: string; name: string } | null
      fundo: { uuid: string; name: string; region: string | null } | null
    }
    ```

15. Añadir `getDeviceContext()` en `front/src/api/` (nuevo archivo `device-context.ts` o agregarlo a `client.ts`):
    ```ts
    export async function getDeviceContext(): Promise<DeviceContext>
    ```
    Hace `GET /api/device-context`.

16. Extender `front/src/api/admin-devices.ts`:
    - `updateDevice(id, { label?, is_active?, fundo_uuid? })` — aceptar el nuevo campo.
    - `getDevices()` ya devuelve `Device[]`; con el tipo extendido fluye solo.

---

## Group 7: Frontend — admin UI para asignar fundo

17. Extender `front/src/modules/admin/components/DeviceFormDialog.tsx` para incluir un selector de fundos:
    - `useEffect` que carga `getFundos()` (ya existe en `front/src/api/admin.ts` o similar — verificar).
    - `<Select>` con opción "Sin fundo" (value=`""` → null) y un `SelectItem` por fundo.
    - En submit, enviar `fundo_uuid: value || null`.

18. En `front/src/modules/admin/DevicesPage.tsx`, añadir columna "Fundo":
    - Resolver `device.fundo_uuid` contra una `Map<uuid, Fundo>` cargada en `load()`.
    - Mostrar `fundo.name` o "—".

---

## Group 8: Frontend — robot muestra contexto

19. Crear hook `front/src/hooks/useDeviceContext.ts`:
    - `useEffect` llama `getDeviceContext()` al montar y cada N segundos (60s).
    - Devuelve `{ empresa, fundo, loading }`.

20. Añadir banner de contexto en `front/src/components/Layout.tsx` (o el archivo del header del robot — verificar la ruta del header global):
    - Modo robot: render `<span>{empresa?.name} › {fundo?.name}</span>` o "Sin fundo asignado" si null.
    - Modo server: omitir el banner.

---

## Group 9: Frontend — SaveDialog migra a camellones

21. Refactor `front/src/modules/vision/components/SaveDialog.tsx`:
    - Cambiar prop `locations: MapLocation[]` por `camellones: Camellon[]`.
    - Renombrar label "Ubicación" → "Camellón" en el dialog.
    - Añadir un toggle inline "Nuevo camellón" que cambia el `<Select>` por un `<Input>` con botón "Crear", o un `<SelectItem value="__new__">` que al elegirse muestra un input.
    - El input solo pide nombre. Al confirmar, llama `createCamellon({ nombre })` (que ya existe en `front/src/api/camellones.ts`) y selecciona el nuevo en el dropdown.
    - Botón "Guardar sin georeferencia" — opcional para esta fase si crea fricción; preferible: el camellón se crea sin lat/lng y el operador lo georeferencia luego desde MapPage. Documentarlo en el toast post-save: "Camellón creado sin coordenadas — asignar desde Mapa".

22. Actualizar `front/src/modules/vision/VisionPage.tsx`:
    - Sustituir `getLocations()` por `getCamellones()` para alimentar `SaveDialog`.
    - Eliminar el state `locations` si ya no se usa en otro lado de la página.

---

## Group 10: Validación manual end-to-end

23. Asegurar que el sync_loop del robot llama tanto `pull_models` como `pull_device_context` y que un fallo en uno no impide el otro.

24. Verificar que el header del robot refleja el cambio dentro del intervalo del polling cuando el admin reasigna el fundo.
