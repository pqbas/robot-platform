# Requirements: Contexto del robot — fundo + ubicación

## Scope

El admin asocia cada robot a un fundo desde el servidor; el robot muestra empresa+fundo como contexto read-only y deja al operador crear camellones (con o sin coordenadas) directamente desde el flujo de operación, sin tener que volver a `MapPage` ni a otra pantalla administrativa. Cierra dos huecos detectados en la prueba real del lab:

1. **No se puede guardar una sesión si el camellón no existe** — el `SaveDialog` actualmente solo permite elegir de un dropdown poblado con `MapLocation[]` (markers GPS). Si el camellón no fue creado antes, el operador no tiene forma de cerrar la sesión.
2. **No hay forma de asociar el robot a un fundo** — `Device` no tiene `fundo_uuid`, ni hay UI para configurarlo. El operador no sabe a qué empresa/fundo pertenece el robot que está usando.

## Inputs / Data

**`Device.fundo_uuid` (nuevo campo)**

| Campo | Tipo | Required | Notes |
|-------|------|----------|-------|
| `fundo_uuid` | `Text` | No (nullable) | FK a `fundos.uuid`. Null = robot sin asignar (estado válido en dev/lab). |

Esquema:

```sql
ALTER TABLE devices ADD COLUMN fundo_uuid TEXT REFERENCES fundos(uuid);
```

**Endpoint nuevo `GET /api/sync/device-context`** (server mode, autenticado por device API key)

Respuesta:

```json
{
  "device_id": "jetson-12345",
  "fundo": {
    "uuid": "...", "name": "Fundo San Pedro", "region": "La Libertad"
  } | null,
  "empresa": {
    "uuid": "...", "name": "Agro Verde S.A."
  } | null
}
```

Si `device.fundo_uuid` es null → `fundo` y `empresa` son null.

**`PUT /api/devices/{id}` extensión** — el body acepta `fundo_uuid: str | None`.

**`Camellon.fundo_uuid`** — ya existe en el modelo (línea `back/models.py:124`). Lo que falta es popularlo automáticamente al crear desde el robot, leyendo `device.fundo_uuid`.

## Behavior

**Admin (vista de servidor):**

- En `DevicesPage`, cada fila muestra el fundo asignado (nombre, o "—" si null).
- Botón "Asignar fundo" en cada fila abre un dialog con un selector cargado desde `GET /api/fundos`. Guardar dispara `PUT /api/devices/{id}` con `fundo_uuid`.
- El admin puede setear o quitar (`null`) la asignación desde el mismo dialog. No hay otra forma de cambiar el fundo de un robot.

**Robot (vista del operador):**

- Header del frontend del robot (al lado del logo / título) muestra `Empresa › Fundo` como texto read-only. Si no hay asignación: muestra "Sin fundo asignado" en gris. El operador no puede editarlo.
- El robot poll el endpoint `/api/sync/device-context` periódicamente (junto con el sync existente) y cachea el resultado localmente. No bloquea operación si el server está caído — usa el último valor conocido.
- En `SaveDialog`:
  - Dropdown muestra **camellones** (no `MapLocation[]`) del fundo actual, cargados desde `GET /api/camellones`.
  - Botón "Nuevo camellón" abre un input inline para crear uno con solo el nombre. El backend lo crea con `fundo_uuid = device.fundo_uuid`, sin coords. Una vez creado, queda seleccionado en el dropdown.
  - Botón "Guardar sin ubicación" cierra la sesión asociándola a un camellón existente sin GPS, o crea uno con un nombre por defecto si el operador no eligió ninguno → la sesión queda en `UnlocatedList` para georeferenciar después desde `MapPage`.
- En `MapPage`, `UnlocatedList` ya existe y funciona: el operador puede tomar un camellón sin coords y clickear el mapa para georeferenciarlo. No requiere cambios funcionales — solo verificar que sigue operativo cuando los camellones se crean desde el SaveDialog.
- Cualquier camellón creado desde el robot hereda `fundo_uuid = device.fundo_uuid`. Si el robot no tiene fundo asignado, el camellón se crea con `fundo_uuid = null` (compatible con estado actual).

## Decisions

- **`fundo_uuid` en `Device`, no en una tabla intermedia** — un robot pertenece a un solo fundo a la vez (por contrato comercial); no hay caso de uso para multi-tenancy en el mismo robot. Tabla intermedia sería sobre-ingeniería.
- **Nullable en lugar de NOT NULL con default** — robots en lab/dev no tienen fundo real. Forzar valor obliga a crear "fundo dummy". El `null` es semánticamente "no asignado" y es estado válido.
- **Endpoint dedicado `/api/sync/device-context` en vez de incluirlo en `/api/sync/models`** — son dos preocupaciones distintas (modelos vs contexto organizacional); separarlos permite cachear independientemente y mantiene cada handler con una responsabilidad clara.
- **El `SaveDialog` cambia su fuente de datos de `MapLocation[]` a `Camellon[]`** — el código actual es un bug latente: muestra "Ubicación" pero internamente llama `findOrCreateCamellon(label)`. Esta fase corrige la confusión: el dropdown es de **camellones** (lo que realmente persiste la sesión), y se renombra "Camellón" en la UI.
- **Crear camellón inline en `SaveDialog`, no abrir un dialog secundario** — el operador ya está en un dialog modal cerrando una sesión; abrir otro dialog encima es fricción innecesaria. Un input que aparece al click de "Nuevo" es suficiente — solo necesita nombre.
- **Reutilizar `UnlocatedList` para georeferenciación posterior** — ya está implementado y funciona; no rehacerlo. Esta fase solo asegura que el flujo completo (crear sin coords → asignar coords desde mapa) sigue operando.
- **La asignación de fundo NO se sincroniza en sentido robot→server** — solo el server escribe. El robot lee. Esto evita conflictos donde un cambio de admin se sobrescribe con un valor stale del robot.
- **Migración manual en server (PostgreSQL)** — alembic batch_alter_table funcionó para SQLite en Phase 4, mismo patrón aquí; en server se aplica directamente con `op.add_column`. Una sola migración 007 cubre ambos.
- **No tests automatizados nuevos** — el cambio backend es ~60 líneas, el frontend es UI; el lab manual cubre el end-to-end. Si esta fase se rompe, se nota inmediatamente al guardar una sesión.

## Context

- See `spec/roadmap.md` — Phase 5 (24 abr 2026): cierra brechas detectadas en la validación de Phase 4.
- See `CLAUDE.md` — Mismo codebase backend para robot y server, modo controlado por `ROBOT_MODE`.
- Existing patterns to follow:
  - Migración Alembic con batch_alter_table compat SQLite/Postgres: `back/alembic/versions/006_library_models.py`
  - Admin dialog con form: `front/src/modules/admin/components/DeviceFormDialog.tsx`
  - Sync endpoint con device auth: `back/routes/sync.py:list_models` (`Depends(get_device_or_none)`)
  - Sync pull pattern: `back/services/sync_pull.py:pull_models` — añadir `pull_device_context` con la misma estructura
  - SaveDialog actual: `front/src/modules/vision/components/SaveDialog.tsx`
  - Camellones API: `back/routes/camellones.py:create_camellon` (extender para inyectar `fundo_uuid` desde device context)
  - UnlocatedList: `front/src/modules/map/components/UnlocatedList.tsx`
