# Plan: UX móvil — acceso a Configuración y auditoría de pantallas clave

## Group 1: Bottom-nav móvil incluye Configuración

1. En `front/src/components/Sidebar.tsx`:
   - En `items` (líneas 52-80) agregar **Configuración** al array `robotItems` cuando `mode === "robot"`. Path `/settings`, icon `Settings` (ya importado).
   - Resultado: 5 items en el bottom-nav del robot (Vision, Mapa, Dashboard, Grabaciones, Configuración).

2. En el bloque mobile bottom-nav (líneas 85-105):
   - Mantener `flex justify-around` pero asegurar que con 5 items quepan en 360px: bajar `px-3` de cada botón a `px-2`, `text-xs` ya está.
   - Si el label "Grabaciones" no cabe en 360px junto a "Configuración", usar `truncate` o acortar a "Videos" + "Config" SOLO en mobile (`text-[10px] sm:text-xs`).
   - El filtro `.filter((item) => !item.separator)` se mantiene.

3. En el footer desktop (líneas 135-166):
   - Quitar el botón "Configuración" del footer (líneas 138-149) porque ahora vive en `items`. Configuración aparece como item normal del sidebar desktop también (es el patrón consistente).
   - Mantener el botón "Sincronizar" en el footer desktop como estaba.

---

## Group 2: Sincronizar accesible desde móvil vía Configuración

4. En `front/src/modules/settings/SettingsPage.tsx`:
   - Agregar un card "Sincronización" en la parte superior visible solo en mobile (`md:hidden`), o como sección permanente si tiene sentido también en desktop.
   - Botón "Sincronizar ahora" que llame al mismo handler de `Sidebar.handleSync` (extraer `forceSyncPush` + `forceSyncPull` con `toast.success` / `toast.error`).
   - Estado local `syncing` igual que el sidebar; deshabilitar botón mientras corre.
   - Mostrar "Última sincronización: <timestamp>" si el backend lo expone. Si no, omitir; no inventar API nueva en esta fase.

5. (Opcional) Extraer el `handleSync` a un hook `useSync()` en `front/src/hooks/useSync.ts` si lo usan tanto Sidebar como SettingsPage. Si la duplicación es 6 líneas, dejarla y no abstraer.

---

## Group 3: Auditoría visual y arreglos puntuales

6. En `front/src/modules/vision/VisionPage.tsx`:
   - Probar en viewport 390×844 con DevTools. Verificar que los badges del overlay (líneas 277-339) no se solapen ni superen 40% del ancho del frame.
   - Action bar (líneas 343-401): cambiar `flex items-center justify-center gap-3` a `flex flex-wrap items-center justify-center gap-2` para que los botones se apilen si no caben. Bajar `min-w-[180px]` a `min-w-[140px]` para que 2 botones quepan en una fila en 390px.
   - Si "Detener {durationStr}" con duración larga ("12m 34s") rompe el botón, mantener el `min-w` pero permitir `flex-wrap`.

7. En `front/src/modules/recordings/RecordingsPage.tsx`:
   - Línea 126: el contenedor ya tiene `overflow-auto`, pero la tabla no fuerza `min-w`. Agregar `<div className="min-w-[600px]">` o `className="min-w-full"` al `<Table>` para que el scroll horizontal se active correctamente en mobile.
   - Verificar que la columna "Acciones" (botones Descargar + Trash) no se corte. Si se corta, agregar `sticky right-0 bg-background` a esa `TableHead` y `TableCell` o aceptar el scroll.
   - Header de página (líneas 115-124): bajar `text-2xl` a `text-xl md:text-2xl` para no ocupar tanto vertical en mobile.

8. En `front/src/modules/settings/SettingsPage.tsx`:
   - Verificar visualmente: cards se ven completos en 390px, inputs no se cortan, botones tappables (≥ 40px alto). El `max-w-2xl` + `p-4 md:p-6` ya debería estar OK, solo confirmar y ajustar paddings si algún card rompe.
   - Si hay grids internos (`grid-cols-2`), forzar `grid-cols-1 md:grid-cols-2`.

9. En `front/src/modules/dashboard/DashboardPage.tsx`:
   - Ya tiene `md:grid-cols-2`, default mobile single column. Verificar que los KPI cards no fuercen scroll horizontal por anchos fijos. Si hay un `min-w` en cards, quitarlo.

10. En `front/src/modules/map/MapPage.tsx`:
    - Ya tiene toggle map/table móvil. Verificar que el toggle (líneas 119-138) sea tappable y visible. No tocar a menos que rompa.

---

## Group 4: Verificación cross-device

11. Probar manualmente en Chrome DevTools con perfiles:
    - **iPhone SE** (375×667): nav móvil + 5 items + cada ruta.
    - **iPhone 12 Pro** (390×844): default moderno.
    - **Galaxy S20 ultra** (412×915): Android moderno.
    - 360×640 (Android antiguo) si el cliente reporta dispositivos viejos.

12. Probar en celular real conectado al WiFi del Jetson (`make run-front` + `make run-robot`). Validar las rutas críticas: Vision (stream + contar), Settings (entrar y volver), Recordings (scroll tabla), Sync (tap en Settings dispara toast).

---

## Group 5: Roadmap

13. Agregar Phase 26 a `spec/roadmap.md` con un par de bullets: acceso a Configuración desde móvil + auditoría de pantallas clave.
