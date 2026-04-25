# Requirements: Verificación del conteo con pesos estándar

## Scope

Permitir al admin **registrar** un modelo de librería (`yolo11n.pt` y similares que ya vienen con `ultralytics`) desde la pantalla de admin, **sin subir un archivo `.pt`**, y verificar end-to-end que el operador puede activarlo desde el robot y contar personas en el laboratorio. Pequeño cambio backend + frontend para soportar "library models" + verificación operativa del flujo completo.

## Inputs / Data

Modelo de librería a registrar:

| Campo | Valor |
|-------|-------|
| `filename` | `yolo11n.pt` |
| `version` | `yolo11n-coco-v1` |
| `source` | `"library"` (campo nuevo; default `"uploaded"` para los actuales) |
| `class_mapping` | `[{"model_label":"person","system_label":"Persona"}]` |
| `is_active` | `true` |
| `file_hash` | `null` o `""` (no aplica para library models) |
| Archivo `.pt` | **no se sube ni se sincroniza** — `ultralytics` lo descarga la primera vez que el worker hace `YOLO("yolo11n.pt")` |

Esquema DB:

```
ALTER TABLE detection_models ADD COLUMN source TEXT NOT NULL DEFAULT 'uploaded';
```

`source` ∈ `{"uploaded", "library"}`. `file_hash` se hace nullable.

## Behavior

1. **Admin abre `ModelsPage`** → ve un botón nuevo "Registrar modelo de librería" además del upload existente.
2. **Admin completa filename + version + class_mapping** y guarda. No se sube archivo.
3. **El registro va a `POST /api/detection-models`** con `source: "library"` (sin `multipart/form-data`).
4. **Admin asigna el modelo al robot** desde `DevicesPage` (sin cambios respecto al flujo actual).
5. **Sync pull en el robot** detecta el modelo asignado, lo upserta en la DB local, **y omite la descarga del `.pt`** porque `source == "library"`.
6. **Operador en `VisionPage`** ve "Persona" en el `ObjectPicker` (igual que con un modelo subido).
7. **Operador selecciona "Persona"** → backend llama `reload_model("yolo11n.pt")` (sin path absoluto) → el worker pasa eso a `ultralytics.YOLO(...)` que lo descarga automáticamente la primera vez y lo carga.
8. **El conteo por cruce de línea** funciona con personas reales en el lab.

## Decisions

- **Library model en vez de pre-cargar archivo en el deploy** — el repo no debe asumir que `yolo11n.pt` está en `data/robot/models/`. La librería `ultralytics` lo descarga la primera vez bajo demanda. Esto evita commits de pesos al repo y mantiene el flujo de admin limpio.
- **Nuevo campo `source` en `DetectionModel`** en vez de un boolean `is_library` — permite extender más adelante (`"library"`, `"uploaded"`, posiblemente `"trained"` si entrenamos en el servidor).
- **`file_hash` nullable solo para library** — los uploads regulares siguen requiriendo hash (no se rompe esa garantía). Para library, no aplica porque el archivo lo gestiona ultralytics.
- **Reload usa filename relativo (`"yolo11n.pt"`) para library, absoluto para uploaded** — `select-label` debe distinguir según `source` de la fila DB. `ultralytics.YOLO("yolo11n.pt")` resuelve descarga automática; un path absoluto a un archivo inexistente, no.
- **No se cambia el formato `CountingConfig`** — sigue siendo global vía `GET/PUT /api/config/counting`. Si `threshold=360` o `direction="top2down"` no encajan con el ángulo de la cámara del lab, se ajusta vía API.
- **Esta fase no agrega tests automatizados** — el cambio backend es pequeño y de validación; los manual checks del lab son la prueba real.

## Context

- See `spec/roadmap.md` — Phase 4 (24–25 Apr): paso previo a Phase 5 (grabación) y Phase 6 (nuevo método de conteo).
- See `CLAUDE.md` — Inference Worker y Camera Worker corren como servicios systemd separados.
- Existing patterns to follow:
  - Upload modelo: `back/routes/admin_models.py:create_detection_model` (extender, no reemplazar)
  - DB schema: `back/models.py:DetectionModel` + migración alembic en `back/alembic/versions/`
  - Sync pull: `back/services/sync_pull.py` (skip download cuando `source == "library"`)
  - Hot-swap: `back/services/perception/inference_client.py:reload_model`
  - select-label: `back/routes/config_routes.py:select_label` (resolver path según `source`)
  - Picker UI: `front/src/modules/vision/VisionPage.tsx` + `front/src/api/vision.ts`
  - Admin UI: `front/src/modules/admin/ModelsPage.tsx`
