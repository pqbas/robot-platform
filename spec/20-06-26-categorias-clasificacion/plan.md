# Plan: Categorías como centro + clasificación post-conteo

Rama de trabajo: `feat/categorias-clasificacion` desde `master`.

> **Dependencia externa (no bloquea construir, sí validar precisión):** el
> usuario sube el `.pt` del clasificador de arándano + la lista ordenada de
> clases desde el frontend. Mientras tanto se construye y testea con
> `SupervisedModel(num_classes=7)` aleatorio.

> **Orden sugerido:** Group 1 (categorías) es la base; Groups 2–3 (cruces +
> worker de clasificación) son independientes y pueden ir en paralelo; Groups 4–7
> dependen de 1.

## Group 1: Hub de categorías (modelo, migración, resolución de conteo)

1. `src/back/models.py`: añadir `Category` (`name` PK, `detection_model_uuid` FK,
   `classification_model_uuid` FK nullable, `method` default `'single'`,
   `count_mode` default `'horizontal'`, `threshold` default `0.5`, `direction`
   default `'left2right'`, `roi_mode` default `'square'`, `confidence` default
   `0.25`, `updated_at`) y `ClassificationModel` (uuid, version, filename,
   file_hash, source, class_names TEXT-JSON, num_classes, latent_dim, imgsz,
   created_at).

2. Migración Alembic (`src/back/alembic/versions/`, `down_revision` = head `021`):
   crear `categories` y `classification_models`. **Backfill**: por cada
   `(model_uuid, label)` con método en `counting_methods.json` y por cada
   `selected_label` activo, sembrar una fila `categories` (name=label,
   detection_model_uuid=model, method=el del JSON o `single`, y la **geometría
   semilla** de `config.counting`: count_mode/threshold/direction/roi_mode/
   confidence). Guards idempotentes.

3. `src/back/services/storage.py`: CRUD de `Category`
   (create/list/get/update/delete; set detector, set/clear clasificador, set
   método) y de `ClassificationModel` (create/list/get/delete por hash).

4. `src/back/services/perception/counting_trigger.py::build_count_config`:
   cambiar la resolución del modelo — en vez de `selected_label.isnot(None)`,
   resolver el `DetectionModel` desde `Category(name=target_class).detection_model_uuid`.
   **Toda la geometría** (method + count_mode/threshold/direction/roi_mode/
   confidence) sale de la categoría (reemplaza `counting_methods.read_method` y
   los defaults de `config.counting`); los `overrides` del diálogo de re-conteo
   siguen pudiendo sobreescribir por-video. Mantener el pin
   (uuid/version/file_hash/engine_path) y `target_model_label`.
   `RuntimeError("no_category")` si la categoría no existe o no tiene detector.

5. `src/back/routes/counting.py` (start/stop) y donde se selecciona "qué contar":
   el target pasa a ser una **categoría**; cargar el detector de la categoría para
   el live (donde hoy se hace `reload_model`/select-label). Retirar el uso de
   `counting_methods` aquí.

6. Retirar `src/back/services/counting_methods.py` y sus usos
   (`config_routes.py` endpoints `counting-methods`, `counting_trigger`) una vez
   migrado a `category.method`. (Si el riesgo es alto por tiled recién entrado,
   dejar `counting_methods` como fallback de solo-lectura y marcar deprecación.)

---

## Group 2: counting-worker — emitir eventos de cruce

7. `src/counting_worker/counting_worker/object_counter.py`: que `update()`
   exponga el **delta** de `track_id` que cruzaron en esa llamada (recién
   agregados a `set_1`), no solo el total.

8. `src/counting_worker/counting_worker/processor.py` (`_count_single` loop
   ~L153-179 y `_count_tiled` loop ~L255-296): por cada track cruzado, tomar su
   detección del frame (bbox ya en frame completo; tiled vía `_tile_detections`)
   y acumular `{track_id, frame, pts, bbox, cls}`.

9. Escribir esos cruces a `{uuid}.crossings.jsonl` (un objeto por línea) junto al
   `{uuid}.jsonl`; `crossings_path` derivado del `jsonl_path`. Devolver
   `crossings: n` en el resultado (sanity ≈ `total_count`).

10. `src/counting_worker/tests/`: afirmar el **delta de cruces** por update.

---

## Group 3: classification-worker (proyecto uv nuevo)

11. Crear `src/classification_worker/` espejo de `src/counting_worker/`:
    `pyproject.toml` con `torch`, `opencv-python`, `pillow`, `numpy` (pin Jetson /
    `.venv` precompilado), `requires-python=">=3.8"`; `__init__.py`, `main.py`,
    `processor.py`, `model/`.

12. `classification_worker/model/`: **vendorear** desde
    `../mlops-classification-blueberry/src/`: `nn/layers.py`, `nn/backbone.py`,
    `models/supervised.py` (ajustar imports relativos).

13. `classification_worker/processor.py` — `classify_video(payload) -> dict`:
    carga `SupervisedModel(latent_dim,num_classes)` + `load_state_dict`; lee
    `crossings_path`; por cruce `cap.set(CAP_PROP_POS_FRAMES, frame)` + crop bbox
    (clamp) + BGR→RGB + resize `(imgsz,imgsz)` estirado + `ToTensor` [0,1] +
    `softmax`; guarda `crops_dir/{track_id}_{frame}.jpg`; escribe línea en
    `classifications_path`; devuelve `{ok, total, distribution}`.

14. `classification_worker/main.py`: copiar máquina de estados + socket de
    `counting_worker/main.py`; `cmd "classify"`/`"status"`; `--control-socket`
    default `os.getenv("CLASSIFICATION_SOCKET", "/tmp/classification.sock")`.

15. `Makefile`: `run-classification`/`-dev`, `logs-classification`,
    `status`/`restart`. Documentar el socket en `CLAUDE.md`.

---

## Group 4: Backend — clasificación lifecycle (cliente, trigger, poller)

16. `src/back/config.py`: `ClassificationWorkerConfig`
    (`CLASSIFICATION_SOCKET`); registrarlo en `Config`. `crops_dir` derivado del
    dir del MP4.

17. `src/back/models.py` + migración: añadir `recording_uuid` a `FruitCrop`; a
    `Recording` `classification_status` (default `'none'`),
    `classification_error`, `classification_config`,
    `classifications_uploaded_at`, `crops_uploaded_at`. (Puede ser la misma
    migración del Group 1.)

18. `src/back/services/perception/classification_client.py`: espejo de
    `counting_client.py` → `ClassificationClient.classify(...)/status()`,
    `ClassificationWorkerUnavailable`.

19. `src/back/services/perception/classification_trigger.py`:
    `build_classification_config(rec)` lee `rec.count_config.target_class`, busca
    `Category(name=...).classification_model_uuid`; `None` si no hay → no se
    ejecuta; si hay, snapshotea el pin. `enqueue_classification(rec)` valida
    `.pt` + `crossings.jsonl`, marca `classifying`, llama `client.classify`; error
    → `classification_status='error'`.

20. `src/back/services/perception/counting_poller.py` (`_process_worker_result`,
    rama `ok`): tras `count_status='done'`, llamar `enqueue_classification(rec)`
    (no-op si la categoría no tiene clasificador).

21. `src/back/services/perception/classification_poller.py`: espejo de
    `counting_poller.py` — `reconcile_orphaned_classifications()` +
    `run_poller()`; en `ok` crea `FruitCrop`(+`recording_uuid`) +
    `FruitClassification` por crop, `done`, `classifications_uploaded_at=None`,
    re-queue `SyncLog`; error → `error`.

22. `src/back/main.py`: registrar `reconcile_orphaned_classifications()` en
    startup + lanzar el poller de clasificación como task de fondo.

23. `src/back/routes/recordings.py`: `POST /{uuid}/reclassify` (re-encola con el
    pin) y `GET /{uuid}/classifications` (agregado para la galería). 404/409 como
    `recount`.

---

## Group 5: Backend — gestión server-authoritative + sync

24. `src/back/routes/` (modo server): CRUD de categorías
    (`/api/categories` — crear, listar, set detector, set/clear clasificador, set
    método + geometría count_mode/threshold/direction/roi_mode/confidence); subir
    clasificador (`POST /api/classification-models` con `.pt` +
    `class_names` + metadata → `data/server/models/`, `file_hash`, fila), listar,
    borrar. Categorías disponibles parten de `GET /api/config/available-labels`.

25. Sync pull (robot): extender el ciclo de pull para descargar `categories`,
    `classification_models` (`.pt` + metadata) al robot (upsert-only, no borrar lo
    creado offline). `.pt` → `data/robot/models/`.

26. Sync push automático: incluir `FruitClassification` + `FruitCrop` (metadata,
    **sin** bytes) gated por `classifications_uploaded_at` (espejo de
    `sync_recordings_upload.py::_upload_detections`) + endpoint `receive_*`.

27. Sync push manual (botón de sesión): subir crops JPG + video gated por
    `crops_uploaded_at` (espejo del MP4 `uploaded_at`) + endpoint server que
    guarda los JPG en `data/server/.../crops/{uuid}/`.

---

## Group 6: Frontend

28. `src/front/src/api/`: `categories.ts` (list/create/update, set detector, set
    clasificador, set método), `classification-models.ts` (list/upload/delete),
    `classifications.ts` (`getClassifications(recordingUuid)`). Tipos en
    `src/front/src/types/`.

29. Server — **vista de Categorías** (el centro): tabla/panel donde cada categoría
    (arándano, persona…) muestra y edita su **detector**, su **clasificador**, su
    **método** y su **geometría de conteo** (count_mode/threshold/direction/
    roi_mode/confidence), con acción para subir un clasificador nuevo.
    Reemplaza/absorbe la config dispersa de modelos+métodos+counting global.
    Gateada a `mode === "server"`.

30. Selección de conteo: donde hoy se elige clase/modelo a contar, pasar a elegir
    una **categoría** (la categoría resuelve detector + método).

31. Sesión/grabación — resultados: tarjeta de **resumen** (distribución por clase)
    + **galería de crops** (thumbnail + clase + confianza). Estado
    `classification_status` visible. Crop local en robot, subido en server.

32. `tsc -b` limpio; sin overlay por-objeto en el replay (fuera de alcance).
</content>
