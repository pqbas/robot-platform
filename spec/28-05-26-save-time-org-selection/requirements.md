# Requirements: selección de organización + camellón al guardar (modo robot)

## Scope

El operador del robot puede elegir Empresa, Fundo y Camellón al guardar una sesión de conteo, incluso offline. La selección queda como contexto activo (sticky) y viene preseleccionada la próxima vez.

## Inputs / Data

### Cascada en SaveDialog

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| empresa | string (nombre) | sí | elegido de catálogo local; se puede crear en el momento |
| fundo | string (nombre) | sí | filtrado por empresa; se puede crear en el momento |
| camellon_id | int | sí | filtrado por fundo; se puede crear en el momento |

### POST /api/device-context/active

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| empresa | string | sí | nombre de la empresa |
| fundo | string | sí | nombre del fundo |

## Behavior

- El catálogo de empresas/fundos se sincroniza del server cuando hay conexión (`pull_catalog`) y queda disponible en SQLite para uso offline.
- `active_context.json` almacena la selección sticky y toma precedencia sobre `device_context.json`; un sync que llama `pull_device_context` nunca pisa el contexto activo.
- Al abrir SaveDialog: los tres selects usan el contexto efectivo como valor por defecto.
- Al guardar: primero se llama `POST /api/device-context/active` para fijar el contexto, luego se guarda la sesión.
- En modo robot los endpoints `/api/empresas/` y `/api/fundos/` son accesibles sin gate de admin (create + list).
- Camellones tienen unicidad compuesta por `(fundo_uuid, nombre)`; el mismo nombre en fundos distintos es válido.

## Decisions

- **Contexto activo separado del contexto sincronizado** — evita que un sync posterior pise la elección del operador; dos archivos JSON distintos, precedencia explícita.
- **Catálogo completo offline** — todas las empresas/fundos disponibles localmente; el operador no necesita conexión para elegir. El push de creaciones nuevas ocurre via sync_push existente, sin wiring extra.
- **Unicidad compuesta (fundo_uuid, nombre) en camellones** — permite reutilizar nombres entre fundos distintos, que es el caso real en campo (varios fundos tienen "Camellón 1").
- **Sin admin gate en robot para empresas/fundos** — decisión de producto; el operador crea en campo y esas filas suben al server vía sync.
- **Arreglo de colisión de migraciones como pre-requisito** — sin resolver el overlap 012/013 de alembic, ningun deploy nuevo es posible.

## Context

- Ver `spec/roadmap.md` — fase 21 (save-time-org-selection).
- Patrón de contexto: `back/services/sync_pull.py`, `back/config.py` `StorageConfig`.
- Patrón de guard idempotente en migraciones: `back/alembic/versions/009_*.py`.
- Patrón de dep condicional por modo: `back/routes/devices.py` (`_device_dep`).
- Frontend SaveDialog existente: `front/src/modules/vision/components/SaveDialog.tsx`.
- API de empresas/fundos ya existente: `front/src/api/admin.ts` (`getEmpresas`, `getFundos`, etc.).
