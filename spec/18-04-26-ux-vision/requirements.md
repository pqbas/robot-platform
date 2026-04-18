# Requirements: UX Vision

## Scope

La pantalla Vision se rediseña en dos pasos: primero el operador elige el tipo de objeto
a detectar desde bloques visuales, luego accede a la pantalla de operación con el stream
y los controles. Después de esta fase, cualquier operador sin conocimiento técnico puede
iniciar una sesión de conteo sin guía.

En el robot pueden coexistir varios modelos descargados. El operador ve las etiquetas
de todos los modelos disponibles (agregadas), elige una, y el sistema carga
automáticamente el modelo asociado a esa etiqueta en el inference worker antes de
iniciar el stream.

En esta fase hay al menos dos modelos:
- **yolo11n.pt** — modelo preentrenado COCO (`person`, `car`, etc.)
- **modelo de arándanos** — custom, etiqueta `arandano`

## Behavior

**Paso 1 — Selección de objeto:**
- El frontend consulta `GET /api/config/available-labels` y muestra una tarjeta por etiqueta
- El operador toca una tarjeta → el frontend llama `POST /api/config/select-label` para
  cargar el modelo correspondiente en el worker
- No hay stream, no hay conexión visible

**Paso 2 — Operación:**
- Idéntico al flujo actual: botón Conectar → stream → Iniciar conteo
- Muestra el objeto seleccionado como contexto (ej: "Detectando: arandano")
- Botón "← Cambiar objeto" visible pero deshabilitado si la cámara está conectada o hay
  sesión activa

## Decisions

- **Etiquetas desde la DB local (SQLite)** — el backend lee `class_mapping` de los modelos
  registrados en la DB del robot y construye el mapa `etiqueta → model_path`. Esto no
  requiere hardcodeo y prepara Phase 4 sin cambios de interfaz.

- **`reload_model` ya existe** — `InferenceClient.reload_model(path)` envía el comando al
  worker vía Unix socket. Se reutiliza sin modificaciones.

- **Carga del modelo ocurre al seleccionar, antes de conectar** — así el worker tiene el
  modelo correcto desde el primer frame, sin race condition.

- **1 etiqueta = 1 modelo responsable** — si dos modelos comparten una etiqueta, el
  comportamiento es indefinido en esta fase. Phase 4 define la resolución de conflictos.

- **Volver al paso 1 solo cuando desconectado** — el bloqueador existente (`useBlocker`)
  se reutiliza sin cambios.

- **No se cambia la lógica de conteo ni los hooks** — `useWebRTC` y `useCounting` quedan
  intactos; el refactor es solo de presentación.

- **Nuevo componente `ObjectPicker`** — se crea separado de `ClassSelector`;
  `ClassSelector` se elimina ya que el dropdown deja de usarse.

## Context

- `spec/mission.md` — esta fase es el primer paso para que el operador de campo use el
  robot sin depender de un investigador.
- `spec/roadmap.md` — Phase 1.
- Patrones a seguir: `back/routes/config_routes.py` (estilo de endpoint de config),
  `front/src/modules/vision/VisionPage.tsx` (estructura de página).
