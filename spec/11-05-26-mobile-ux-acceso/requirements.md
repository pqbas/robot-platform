# Requirements: UX móvil — acceso a Configuración y auditoría de pantallas clave

## Scope

El operador usa el robot desde su celular conectado al WiFi del Jetson. Hoy puede ver `/vision`, `/mapa`, `/dashboard` y `/recordings` desde el bottom-nav móvil, pero **no puede llegar a `/settings`** porque ese botón vive solo en el footer del sidebar desktop. Tampoco puede disparar "Sincronizar" manualmente. Esta fase entrega:

1. Acceso a Configuración y Sincronizar desde móvil en modo robot.
2. Auditoría visual de las pantallas que sí están accesibles (`/vision`, `/recordings`, `/dashboard`, `/mapa`, `/settings`) en viewport de celular vertical (≤ 480px ancho), arreglando los layouts rotos que aparezcan.

Fuera de scope:
- Modo server desde celular remoto (eso es otra fase: `UserMenu` mobile, tablas server, etc.).
- Rediseño profundo o sistema de design tokens. Solo arreglos puntuales que destraben uso real.
- Pantallas admin (`/admin/*`) — no se accede desde el robot.

## Behavior

Tras esta fase, en un celular conectado al WiFi del Jetson:

1. El operador abre el robot y ve el bottom-nav con todas las rutas que necesita, incluyendo **Configuración**. Tap en Configuración → carga `/settings` y vuelve con back del navegador o tap en otra pestaña.
2. El bottom-nav cabe en pantallas angostas (≥ 360px) sin que los labels se corten ni se solapen los iconos. Si los 5 items no caben con texto, los labels más largos se acortan o se omiten en viewport estrecho.
3. Existe una vía móvil para "Sincronizar" en modo robot: o como botón en el bottom-nav, o como acción dentro de Configuración. La elección se documenta en Decisions.
4. `/vision` en celular vertical:
   - Los badges del overlay no tapan más del 40% del frame ni se cortan al borde.
   - La action bar (Contar/Grabar/Detener) no fuerza scroll horizontal. Botones se apilan en columna si no caben en fila.
5. `/recordings` en celular vertical: la tabla puede hacer scroll horizontal o renderizar como cards apiladas; lo decidimos en plan. No debe romper la página ni esconder columnas críticas (Inicio, Duración, Acciones).
6. `/settings` en celular vertical: los cards y forms se ven completos, los inputs no se cortan, los botones de acción son tappables (≥ 40px alto).

Edge cases:
- Viewport 360×640 (Android antiguo) y 390×844 (iPhone moderno) deben funcionar sin scroll horizontal en ninguna ruta del robot.
- Rotar a landscape no debe romper layouts; el bottom-nav puede ocultarse si la altura < 500px (ya hay precedente en navegadores que minimizan barras), pero no es requisito.

## Decisions

- **Mover Configuración al bottom-nav móvil, no a un menú overflow** — el bottom-nav del robot ya tiene 4 items (Vision/Mapa/Dashboard/Grabaciones); meter un 5to (Configuración) es viable en pantallas ≥ 360px si reducimos paddings y labels cortos. Un menú "más" con popover agrega una capa de fricción para una acción que el operador usa cuando algo está mal (peor momento para esconder cosas).
- **Sincronizar va dentro de Configuración, no en el bottom-nav** — el flujo natural ya es "abrir settings cuando algo falla". Sync es acción operacional poco frecuente; mantenerla en el footer del sidebar desktop pero exponerla como botón visible en `/settings` cubre móvil sin inflar el bottom-nav.
- **Solo robot mode en scope** — el usuario reportó el problema desde celular en WiFi del robot. Server mode (admin/operador remoto) tiene otras pantallas (admin/users, etc.) que requieren tratamiento separado y más amplio (tablas admin, modales). Lo dejamos para fase futura.
- **Auditar las 5 pantallas robot, arreglar solo lo que rompe uso real** — no es rediseño; es destrabar. Si un layout se ve apretado pero usable, se anota como deuda y no se toca acá. Si bloquea una acción (botón fuera de pantalla, input invisible), se arregla.
- **Tabla de Grabaciones: scroll horizontal con sticky en primera columna** — más barato que rehacer la tabla como cards. Phase mobile podría adoptar cards más adelante; para destrabar uso, scroll horizontal alcanza. Decisión revisable si en auditoría se ve que el scroll es muy molesto.
- **No tocar el comportamiento desktop** — todos los cambios se aplican vía media queries Tailwind (`md:` prefix) para preservar el sidebar lateral en desktop. Cero regresión en escritorio.

## Context

- See `spec/roadmap.md` — esta fase entra como Phase 26.
- Existing patterns to follow:
  - `front/src/components/Sidebar.tsx:82-186` — sidebar dual (bottom-nav móvil + lateral desktop). Punto principal a tocar.
  - `front/src/modules/map/MapPage.tsx:117-160` — único ejemplo actual de toggle móvil/desktop con `md:` (mapa vs tabla). Patrón a imitar si necesitamos algo similar.
  - `front/src/App.tsx:9` — `main` ya tiene `pb-14 md:pb-0` para dejar espacio al bottom-nav.
  - `front/src/modules/vision/VisionPage.tsx:253-401` — overlay y action bar que se auditan.
  - `front/src/modules/recordings/RecordingsPage.tsx:113-195` — tabla a hacer responsive.
- Síntoma reportado por el usuario el 2026-05-11: "desde un dispositivo móvil no se puede ingresar a la pestaña de configuración".
