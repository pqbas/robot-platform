# Validation: Multi-Active Models

La fase está lista para mergear cuando el build de TypeScript es limpio y
los checks manuales pasan.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores de TypeScript ni de build

## Manual Checks

**Activar múltiples modelos:**
- [ ] Con dos modelos en la tabla, activar el primero → badge "Activo", el segundo
  sigue como estaba (no se desactiva automáticamente)
- [ ] Activar el segundo → ambos muestran badge "Activo" simultáneamente

**Desactivar:**
- [ ] Un modelo activo muestra botón "Desactivar" en su fila
- [ ] Hacer clic en "Desactivar" → badge cambia a "Inactivo", el resto no cambia

**Sync en modo robot (sin server):**
- [ ] Con dos modelos activos en el server, el robot descarga ambos `.pt` en el
  próximo ciclo de sync
  (verificar en logs: dos líneas `Sync pull: <filename> not found locally, downloading`)

## Definition of Done

Build TypeScript limpio, múltiples modelos pueden estar activos simultáneamente,
y el botón "Desactivar" funciona de forma independiente por fila.
