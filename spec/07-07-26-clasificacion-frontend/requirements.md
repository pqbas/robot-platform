# Requirements: Frontend de visualización de clasificación de madurez

## Scope

Hacer visible en el frontend el resultado de la **segunda etapa** del pipeline
offline (conteo → clasificación de madurez). Hoy, cuando una grabación se cuenta
y luego se clasifica, los resultados aterrizan en `fruit_crops` /
`fruit_classifications` y son alcanzables por API, pero **ningún componente del
frontend los muestra**. Al terminar esta fase, el operador puede, desde la tabla
de sesiones:

- ver de un vistazo si una sesión fue clasificada (badge de estado),
- abrir el detalle de la sesión y ver la **distribución de madurez** (cuántos
  por clase) más una **galería de recortes** (el JPG de cada objeto contado con
  su etiqueta + confianza),
- **re-clasificar** bajo demanda (solo robot).

Fuera de alcance: el overlay de etiquetas de madurez sobre el video en
`DetectionReplayDialog` (queda como fase 2 opcional), y cualquier cambio al
pipeline de clasificación en sí (workers, modelo, triggers) — ya existen.

El backend ya expone casi todo (`GET /api/recordings/{uuid}/classifications`,
`POST /api/recordings/{uuid}/reclassify`, `classification_status` en
`RecordingOut`). Esta fase es **mayormente frontend**, con dos toques mínimos de
backend que hoy faltan y son prerequisito (ver Decisiones): servir el JPG del
recorte, y exponer `classification_status` a nivel de sesión.

## Inputs / Data

Respuesta de `GET /api/recordings/{uuid}/classifications` (ya existe,
`back/routes/recordings.py:560`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `status` | `str` | `none` \| `classifying` \| `done` \| `error` (== `classification_status`) |
| `error` | `str \| null` | Motivo cuando `status == "error"` |
| `distribution` | `{ [label: string]: number }` | Conteo por clase de madurez (p. ej. `{"ripe": 900, "unripe": 334}`) |
| `crops` | `Crop[]` | Un objeto por recorte |

`Crop`:

| Campo | Tipo | Notas |
|-------|------|-------|
| `track_id` | `number` | ID del objeto contado |
| `label` | `string \| null` | Clase de madurez predicha (null si aún sin clasificar) |
| `confidence` | `number \| null` | 0–1 |
| `bbox` | `[number, number, number, number]` | `[x, y, w, h]` en píxeles de frame completo |
| `crop` | `string` | **Nombre de archivo** del JPG (p. ej. `7_214.jpg`) — NO una URL |

**Backend faltante (prerequisito de esta fase):**

- No existe endpoint que sirva el JPG del recorte. El `crop` es solo un
  filename; el `<img>` necesita una URL. Hay que agregar
  `GET /api/recordings/{uuid}/crops/{filename}`.
- `SessionOut` (`back/schemas.py:56`) expone `count_status`/`count` pero **no**
  `classification_status`. Sin él, la tabla de sesiones no puede pintar un badge
  por fila sin un fetch extra por sesión.

## Behavior

- **Tabla de sesiones (`SessionsTable`).** Junto al estado de conteo, un
  indicador compacto de clasificación derivado de `s.classification_status`:
  `classifying` → spinner "clasificando…"; `done` → badge "madurez ✓" (o un mini
  resumen); `error` → badge "error" con `title`; `none` → nada (no toda sesión se
  clasifica: es opt-in por categoría). El indicador **no** debe gritar cuando una
  categoría no tiene clasificador — `none` es el caso normal y silencioso.
- **Detalle de sesión (`SessionDetail`).** Nueva sección "Madurez" que hace
  **fetch perezoso** de `/classifications` al montar (solo si hay
  `recording_uuid`). Si `status === "done"` y hay crops: barras de proporción por
  clase + galería de miniaturas (cada una con su etiqueta y % de confianza). Si
  `classifying`: spinner. Si `error`: mensaje con el motivo. Si `none` / sin
  crops: la sección se oculta (no ocupa espacio en sesiones no clasificadas).
- **Re-clasificar (solo robot).** Botón en la sección "Madurez" que llama
  `POST /{uuid}/reclassify`; muestra toast y refresca. 409 (categoría sin
  clasificador / no contado) se muestra como toast de error legible, no como
  crash.
- **Permisos / modos.** La visualización (distribución + galería) está en robot
  y server. La acción de **re-clasificar** solo en robot (igual criterio que
  "Re-contar", `SessionsTable.tsx:233`).

## Decisions

- **Incluir dos toques mínimos de backend pese a ser "fase frontend".** Servir el
  JPG del recorte es imposible de evitar (un `<img>` necesita URL, y hoy no
  existe la ruta), y exponer `classification_status` en `SessionOut` es lo que
  permite el badge por fila sin N fetches. Ambos son espejo exacto de patrones ya
  presentes (`/{uuid}/file` con `FileResponse`; `_attach_count_status` para
  `count_status`), así que el riesgo es bajo y se mantienen dentro de la fase en
  vez de abrir una fase de backend separada.
- **Galería + distribución viven en `SessionDetail`, con fetch perezoso — no en
  la fila de la tabla.** Los crops pueden ser cientos por sesión; cargarlos por
  fila reventaría la lista. La fila solo muestra un badge de estado barato
  (derivado de `classification_status`, ya en el payload de sesión tras el toque
  de backend). Los datos pesados se cargan solo al abrir el detalle.
- **Barras de proporción en CSS, sin nueva dependencia de charting.** La
  distribución son 2–4 clases; un set de barras horizontales con `width: %` y un
  color por clase basta y evita sumar una dependencia. (Si `recharts` ya está en
  el bundle del dashboard, un `BarChart` chico es aceptable, pero no se agrega
  solo para esto.)
- **Colores por clase derivados, no etiquetas hardcodeadas.** `class_names` los
  define el modelo (`ripe`/`unripe`/... o en español), así que el color se asigna
  por orden/paleta determinista con fallback, sin asumir nombres concretos. Evita
  romper si el modelo cambia sus clases.
- **El overlay de madurez en el replay se difiere.** `DetectionReplayDialog` ya
  pinta cajas de detección; superponer la etiqueta de madurez es valioso pero
  mayor (alinear crops↔frames en el player) y no es necesario para "hacer visible
  el resultado". Se deja anotado como posible fase 2.
- **`none` es silencioso.** La clasificación es opt-in por categoría
  (`classification_trigger.py`: sin clasificador → no-op, status queda `none`).
  La UI no debe sugerir que "falta clasificar" en sesiones cuya categoría no
  tiene clasificador; simplemente no muestra nada.

## Context

- See `spec/roadmap.md` — continúa la línea de conteo/clasificación (fases
  `15-06-26-conteo-diferido`, `20-06-26-categorias-clasificacion`).
- See `spec/20-06-26-categorias-clasificacion/` — la fase que entregó el pipeline
  de clasificación (worker, tablas, triggers, endpoints). Esta fase es su cara
  visible.
- Backend ya existente:
  - `back/routes/recordings.py:560` — `GET /{uuid}/classifications` (contrato de
    datos de arriba).
  - `back/routes/recordings.py:513` — `POST /{uuid}/reclassify`.
  - `back/routes/recordings.py:284` — `GET /{uuid}/file` con `FileResponse`
    (patrón a copiar para servir crops).
  - `back/services/perception/classification_trigger.py:42` — `crops_dir_for`
    (dónde viven los JPG en disco).
  - `back/schemas.py:56` (`SessionOut`) y `back/services/storage.py:247`
    (`_attach_count_status`) — dónde exponer `classification_status`.
- Patrones de frontend a seguir:
  - `src/front/src/modules/map/components/SessionsTable.tsx:164` — celda "Conteo"
    dirigida por `count_status` (espejo para el indicador de clasificación).
  - `src/front/src/api/recordings.ts` — estilo de los clientes de API
    (`getRecordingDetections`, `recountRecording`, `getRecordingFileUrl`).
  - `src/front/src/types/index.ts:20` (`CountStatus`) y `:22` (`Session`) — dónde
    agregar `ClassificationStatus` y `classification_status`.
  - `src/front/src/modules/map/components/DetectionReplayDialog.tsx` — patrón de
    fetch perezoso de datos de una grabación al abrir.
