# Validation: Contexto del robot — fundo + ubicación

Implementación lista para mergear cuando todos los siguientes checks pasen.

## Automated Tests

- [ ] `cd back && uv run alembic -c back/alembic.ini upgrade head` aplica la migración `007_device_fundo` sin errores en SQLite (robot)
- [ ] `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head` aplica la migración en PostgreSQL (server)
- [ ] `cd front && npm run build` compila sin errores de TypeScript

### Specific test coverage required

No se agregan tests automatizados nuevos (decisión documentada en `requirements.md`). El cambio backend es chico y la validación real es manual end-to-end.

## Manual Checks

**Server / admin:**

- [ ] En `DevicesPage`, cada robot lista una columna "Fundo" — los preexistentes muestran "—"
- [ ] Editar un device → el dialog muestra el selector de fundo con la lista correcta y la opción "Sin fundo"
- [ ] Asignar un fundo a un robot → recargar la página y la columna muestra el fundo
- [ ] Cambiar el fundo a "Sin fundo" → la fila vuelve a mostrar "—"
- [ ] El robot **no** tiene UI para cambiar su propia asignación (verificar en `/vision`, `/map`, header)

**Robot — contexto visible:**

- [ ] Al iniciar el robot sin asignación, el header muestra "Sin fundo asignado"
- [ ] Asignar un fundo desde el admin del server → en menos de ~60 segundos (siguiente tick del sync_loop) el header del robot muestra `Empresa › Fundo`
- [ ] Apagar el server → el header sigue mostrando el último valor cacheado (no se limpia)

**Robot — flujo de SaveDialog:**

- [ ] Iniciar y detener una sesión de conteo → `SaveDialog` muestra dropdown "Camellón" (no "Ubicación")
- [ ] El dropdown lista los camellones existentes (no `MapLocation[]`)
- [ ] Botón "Nuevo camellón" → input aparece, escribir nombre → al confirmar, el camellón se crea y queda seleccionado
- [ ] Guardar la sesión → se persiste asociada al camellón nuevo, sin coordenadas
- [ ] El camellón nuevo aparece en `MapPage` → `UnlocatedList` (sin coords)
- [ ] Click en un camellón de `UnlocatedList`, click en el mapa → coords se asignan
- [ ] Refresh → el camellón ya no está en `UnlocatedList` y aparece como pin en el mapa

**Robot — herencia de `fundo_uuid`:**

- [ ] Con el robot asignado a Fundo X, crear un camellón nuevo desde `SaveDialog`
- [ ] Verificar en la DB del robot: `SELECT nombre, fundo_uuid FROM camellones WHERE nombre='<nuevo>'` → `fundo_uuid` es el del Fundo X
- [ ] Sync push → en el server, el camellón aparece con el mismo `fundo_uuid`

**Edge cases:**

- [ ] Desasignar el fundo del robot mientras está corriendo → el header refleja el cambio en el siguiente poll, los camellones existentes no se mueven
- [ ] Crear un camellón cuando el robot no tiene fundo asignado → se crea con `fundo_uuid = null` (estado válido pre-existente)

## Definition of Done

Todos los checks anteriores pasan, la migración está aplicada en server y robot, y el operador puede cerrar una sesión cuyo camellón no existía previamente sin abandonar el flujo de operación.
