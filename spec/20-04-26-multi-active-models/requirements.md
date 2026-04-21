# Requirements: Multi-Active Models

## Scope

La asignación de múltiples modelos por robot ya existe (tabla `device_models`,
implementada en la fase `device-model-assignment`). Esta fase entrega solo
la pieza que falta: eliminar la restricción de un único modelo activo a la vez,
y agregar un botón "Desactivar" en la tabla de modelos.

## Behavior

**Activar / Desactivar:**
- Un modelo puede activarse sin desactivar los demás.
- Un modelo activo puede desactivarse individualmente.
- La tabla `/admin/models` muestra el badge "Activo"/"Inactivo" igual que hoy,
  pero puede haber varios activos simultáneamente.

**Efecto en sync (robot mode):**
- `GET /api/sync/models` sin auth de device ya filtra por `is_active == True`.
  Con múltiples activos, el robot recibirá todos los modelos marcados como activos,
  los descargará y los registrará en su DB local.

**Efecto en sync (server mode):**
- La ruta filtra por `device_models`, no por `is_active`. Sin cambios.

## Decisions

- **Eliminar la lógica "deactivate all others"** — la restricción de uno activo
  era una simplificación inicial. Con múltiples robots y modelos especializados
  el admin necesita marcar como activos varios modelos distintos sin que uno
  sobreescriba al otro.

- **Agregar `PUT /api/detection-models/{uuid}/deactivate`** — endpoint simétrico
  al de activar, en lugar de reutilizar `PATCH`, para mantener la API consistente
  y legible.

- **El flag `is_active` no determina qué modelo usa el worker** — eso lo decide
  `select-label` / `reload_model`. `is_active` solo controla qué modelos se
  envían al robot en el ciclo de sync (modo robot sin server).

## Context

- `back/routes/admin_models.py` — aquí se modifica `activate_model` y se agrega
  `deactivate_model`
- `front/src/api/admin-models.ts` — aquí se agrega `deactivateModel()`
- `front/src/modules/admin/ModelsPage.tsx` — aquí el botón "Activar" pasa a ser
  toggle; se muestra "Desactivar" cuando el modelo está activo
- `spec/18-04-26-device-model-assignment/` — la fase que implementó la asignación
  por dispositivo; este cambio no la toca
