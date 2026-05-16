# Backlog — observaciones pendientes de trabajar

Notas crudas, sin priorizar, para convertir en `/spec-phase` cuando toque.

---

## 1. Configuración de detección y área de detección

Sección `Detección` en `front/src/modules/settings/SettingsPage.tsx:257-344`.

### Problemas detectados

- **Persistencia partida en tres lugares sin criterio claro.**
  - `selected_label` → SQLite (`DetectionModel.selected_label`). Sí persiste.
  - `roi_mode`, `confidence_threshold`, `count_mode`, `threshold`, `direction` → dataclass `CountingConfig` en memoria (`back/config.py:60-66`). **NO persiste.** Reiniciar el backend los devuelve a defaults.
  - Camera preset (1080p/720p) → `data/robot/camera_settings.json`. Sí persiste.
  - Camera low-level (index/width/height/crop) → `CameraConfig` en memoria. **NO persiste.**

- **Mezcla de dominios en la UI.** La sección "Detección" combina: selección de modelo + área (ROI) + umbral de confianza. Pero esos campos viven en `CountingConfig`, no en un `DetectionConfig` propio. El endpoint `PUT /api/config/counting` recibe 5 campos heterogéneos.

- **Duplicación zombie.** `PerceptionConfig` (`back/config.py:28-33`) tiene su propio `confidence_threshold` y `default_target_class` que nadie lee. Está duplicado con `CountingConfig`.

- **"Área de detección" promete más de lo que entrega.** Hoy es toggle binario `square` (crop centrado de lado = altura del frame) vs `full` (todo el frame con letterbox). Ver `inference/inference_worker/detector.py:118-145`. No es un área configurable; es un switch. El overlay del frontend (`RoiOverlay.tsx`) sólo dibuja ese cuadrado fijo.

### Direcciones posibles (a decidir)

- Persistencia: ¿unificar todo a la DB del robot? ¿o a un único `robot_settings.json`?
- Scope: ¿per-robot local, o per-fundo/empresa centralizado desde el server vía sync (como `device_context`)?
- ROI real: ¿permitir dibujar un rectángulo/polígono sobre el frame en lugar del toggle?
- Separar `DetectionConfig` (modelo + ROI + confianza) de `CountingConfig` (línea + dirección), con endpoints distintos.

---

## 2. Editar sesión guardada

Hoy una `Session` se crea via `findOrCreateCamellon` + `saveSession` y queda inmutable.

Falta:

- Endpoint backend tipo `PUT /api/sessions/{id}` para editar campos (nombre del camellón asociado, target_class, total_count manual override, notas).
- UI en `MapPage`/`SessionsTable` para abrir un detalle editable.
- Decidir qué campos son editables y cuáles no (¿`start_time`/`end_time` se tocan? ¿`total_count` se puede sobreescribir o sólo se anotan correcciones?).
- Sync robot ↔ server: hoy `receive_sessions` es insert-only (`back/services/sync_receive.py:115-140`). Si una sesión editada en el robot ya se subió, el server la ignora. Hay que pensar reconciliación.

---

## 3. Lista de camellones muy larga

Los camellones disponibles se muestran como una lista plana que puede crecer indefinidamente — cada nombre nuevo desde Vision o el server agrega una fila. Sin search, sin agrupación, sin paginación.

Lugares afectados:

- Select de camellón al guardar sesión (`front/src/modules/vision/components/SaveDialog.tsx`).
- Cualquier dropdown/listado en `MapPage` que muestre todos los camellones.

Direcciones:

- Search/filter por nombre (typeahead) en el select.
- Agrupación por fundo (los camellones ya tienen `fundo_uuid`).
- Archivar/ocultar camellones viejos sin borrar (flag `archived`).
- Paginación o virtualización si la lista cruza N filas.

Pregunta de fondo: ¿hay vida del camellón después de la cosecha? Si no, lo lógico es que un camellón "cerrado" desaparezca de los selects por default.

---

## 4. Imagen 1080p no reescala al tamaño de la pantalla

Al usar resolución de captura 1080p, el video que llega por WebRTC se renderiza en su tamaño nativo y no se ajusta al viewport del navegador. En pantallas más chicas se corta o se ve mal.

Probable lugar a tocar: `front/src/hooks/useWebRTC.ts` + el `<video>` que lo consume (probablemente en `VisionPage` o un componente de stream).

Direcciones:

- CSS: `video { width: 100%; height: 100%; object-fit: contain }` para que se escale manteniendo aspect ratio.
- Verificar que el contenedor padre tenga dimensiones definidas (no `auto`).
- Considerar si querés `object-fit: cover` (llena el contenedor, recorta) vs `contain` (cabe completo, deja bandas) según UX.
- En 720p capaz no se nota porque el video ya cabe; el bug se hace visible recién en 1080p.

Nota cruzada: este problema interactúa con el ROI cuadrado — si el video escala raro y encima dibujás un overlay ROI calculado en píxeles naturales, el overlay puede quedar desalineado.

---

## Convenciones para esta lista

- Cada bloque se convierte eventualmente en una fase con `/spec-phase`.
- Antes de empezar, conversar con el usuario las decisiones clave (no auto-redactar requirements/plan/validation).
- Si una observación nueva aparece en otra conversación, agregarla acá.
