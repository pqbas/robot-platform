# Validation: UX móvil — acceso a Configuración y auditoría de pantallas clave

Implementación lista para mergear cuando todos los siguientes pasen.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores TypeScript ni warnings nuevos.
- [ ] `cd front && npx tsc --noEmit` exits 0.

### Specific test coverage required

No se requieren tests automatizados nuevos: los cambios son CSS/JSX puro sin lógica de negocio. La validación es manual en viewport real.

## Manual Checks

Realizar en Chrome DevTools con device emulation **y** en un celular real conectado al WiFi del Jetson.

### Acceso a Configuración desde móvil

- [ ] En viewport 390×844 (iPhone 12 Pro), abrir `/vision` → el bottom-nav muestra 5 items: Vision, Mapa, Dashboard, Grabaciones, Configuración.
- [ ] Tap en "Configuración" → navega a `/settings` y la página renderiza completa.
- [ ] Back del navegador desde `/settings` regresa a `/vision`.
- [ ] En viewport 360×640, los 5 items del bottom-nav caben sin que los labels se corten ni los iconos se solapen.
- [ ] En desktop (≥ 768px), Configuración aparece como item del sidebar lateral (no duplicado), y NO aparece dos veces.

### Sincronizar accesible desde móvil

- [ ] En `/settings` (móvil), aparece el card "Sincronización" con botón "Sincronizar ahora".
- [ ] Tap en "Sincronizar ahora" muestra toast "Sincronizado" si la red está OK, o toast de error si no.
- [ ] Botón queda deshabilitado durante la operación (no se puede tap doble).
- [ ] En desktop, el botón "Sincronizar" del footer del sidebar sigue funcionando igual que antes.

### Auditoría de pantallas

- [ ] `/vision` en 390×844: action bar con 2 botones (Contar + Grabar) cabe en una fila sin scroll horizontal. Con 3 botones (Contar + Grabar + Detener), si no caben en fila, se apilan con `flex-wrap`.
- [ ] `/vision`: badges del overlay (Stream FPS, Detectando, Resolución, etc.) no tapan más del 40% del frame en vertical.
- [ ] `/recordings` en 390×844: la tabla se scrollea horizontalmente sin romper la página. Columna "Acciones" siempre alcanzable (scroll o sticky).
- [ ] `/settings` en 390×844: todos los cards visibles, inputs no se cortan, botones tappables (altura ≥ 40px medido con DevTools).
- [ ] `/dashboard` en 390×844: cards en columna única, sin scroll horizontal.
- [ ] `/mapa` en 390×844: toggle map/table sigue funcionando (precedente intacto).

### No regresión desktop

- [ ] En 1920×1080 (desktop) las 5 rutas se ven como antes. Sidebar lateral con todos los items. Footer del sidebar con Sincronizar (y UserMenu en server mode).
- [ ] Colapsar/expandir el sidebar desktop sigue funcionando.

## Definition of Done

Todos los checkboxes anteriores marcados, branch rebased contra `dev`, sin `console.log` ni TODOs dejados, sin código muerto del botón Configuración duplicado. El operador puede abrir el robot desde el celular y llegar a `/settings` sin pasar por un escritorio.
