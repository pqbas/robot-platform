# Plan: Verificación del conteo con pesos estándar

## Group 1: Schema + migración

1. Agregar columna `source` a `back/models.py:DetectionModel`:
   - Tipo: `Mapped[str]` con `default="uploaded"`, no-nullable.
   - Valores válidos: `"uploaded"`, `"library"`.

2. Hacer `file_hash` nullable en `DetectionModel` (`Mapped[str | None]`). Los uploads regulares lo seguirán llenando; library models no.

3. Crear migración alembic en `back/alembic/versions/` (siguiente número, p.ej. `003_library_models.py`):
   - `op.add_column("detection_models", sa.Column("source", sa.Text(), nullable=False, server_default="uploaded"))`
   - `op.alter_column("detection_models", "file_hash", existing_type=sa.Text(), nullable=True)`
   - Downgrade simétrico.
   - **No usar `batch_alter_table`** (lección de la migración 002) — usar `op.add_column` y `op.alter_column` directos para compatibilidad con PostgreSQL.

4. Aplicar migración local en server: `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head`.

5. Aplicar migración en robot (SQLite): `ENV_FILE=.env.robot uv run alembic -c back/alembic.ini upgrade head`.

---

## Group 2: Backend — registrar y servir library models

6. En `back/routes/admin_models.py`, agregar endpoint nuevo `POST /api/detection-models/library`:
   - Body JSON (no multipart): `{"filename": str, "version": str, "class_mapping": str, "notes": str | None, "is_active": bool}`.
   - Crea `DetectionModel` con `source="library"`, `file_hash=None`, sin tocar disco.
   - Requiere admin (mismo guard que el endpoint actual).
   - Devuelve el `DetectionModelOut` igual que el upload regular.

7. En `back/routes/admin_models.py:create_detection_model` (el upload existente con archivo), llenar `source="uploaded"` explícitamente. No modificar más nada.

8. En `back/routes/admin_models.py:update_detection_model`, validar que **no** se intente reemplazar el `.pt` de un library model (rechazar con `400` si `model.source == "library"` y se incluye `file`).

9. En `back/routes/sync.py` (el endpoint que devuelve la lista de modelos al robot), incluir `source` en la respuesta (`SyncModelOut` o el schema equivalente).

10. En `back/services/sync_pull.py`, en el bucle de descarga (línea ~95–110): saltarse la descarga si `model["source"] == "library"`. El registro DB se sigue creando/actualizando, pero no se hace `GET /api/sync/models/{uuid}`. Loguear `Sync pull: %s is library model, skipping download`.

11. En `back/routes/config_routes.py:select_label`:
    - Antes de construir `abs_path`, leer la fila de `DetectionModel` por `model_filename` (o pasar `uuid` desde el frontend; **decidir aquí** — leer por filename mantiene compat con frontend actual).
    - Si `source == "library"`: pasar `body.model_filename` (relativo, sin path) a `client.reload_model(...)`.
    - Si `source == "uploaded"`: comportamiento actual (`Path(config.storage.models_dir) / body.model_filename`).

12. Verificar que `back/services/perception/inference_client.py:reload_model` y el worker (`inference/inference_worker/main.py`) aceptan un path relativo. Probar manualmente: `client.reload_model("yolo11n.pt")` → ultralytics debe descargar y cargar sin error. Si falla, ajustar el worker para resolver vía `YOLO(model_path)` que ya delega a ultralytics.

---

## Group 3: Frontend — UI para registrar library model

13. En `front/src/api/admin.ts` (o donde estén las llamadas a `/api/detection-models`), agregar:
    ```ts
    export function registerLibraryModel(payload: {
      filename: string
      version: string
      class_mapping: string
      notes?: string
      is_active: boolean
    }): Promise<DetectionModel>
    ```
    Llama a `POST /api/detection-models/library` con JSON.

14. En `front/src/modules/admin/ModelsPage.tsx`:
    - Agregar botón "Registrar modelo de librería" junto al botón actual de upload.
    - Abre un dialog (`Dialog` de shadcn/ui ya disponible) con campos: `filename`, `version`, `class_mapping` (textarea con placeholder `[{"model_label":"person","system_label":"Persona"}]`), `notes`, checkbox `is_active`.
    - Submit llama `registerLibraryModel`.
    - Refresca la lista.

15. En la tabla de modelos en `ModelsPage.tsx`, agregar una columna o badge mostrando `source` (`"📦 Librería"` vs `"📄 Subido"`) — solo si encaja sin reescribir la tabla. Si no encaja sin esfuerzo, omitir.

---

## Group 4: Verificación operativa en el lab

16. Levantar servidor: `make run-server`. Login como admin en el frontend (`http://localhost:5174` o equivalente).

17. Registrar `yolo11n.pt` como library model con `class_mapping=[{"model_label":"person","system_label":"Persona"}]`, `is_active=true`.

18. En `DevicesPage` → `DeviceModelsDialog`, asignar `yolo11n.pt` al robot. Guardar.

19. En el robot (SSH), forzar sync: `curl -X POST http://localhost:8080/api/sync/pull`. Verificar logs (`make logs`) que muestren `is library model, skipping download` y que el row se creó en SQLite.

20. Verificar que **no** existe `data/robot/models/yolo11n.pt` (no debería haberse descargado por sync).

21. Abrir frontend del robot. En `VisionPage`, verificar que el `ObjectPicker` muestra "Persona". Seleccionar.

22. Verificar logs del worker (`make logs-inference`): debe mostrar la primera carga de `yolo11n.pt` (ultralytics imprime una línea sobre la descarga si no estaba en caché).

23. Iniciar sesión de conteo. Verificar:
    - Stream WebRTC fluido con bounding boxes sobre personas.
    - Línea de cruce dibujada según `CountingConfig`.
    - Cruzar la línea en la dirección configurada → contador +1.
    - Tres personas en secuencia → contador +3.
    - Sesión guardada al detener.

24. Si la línea o dirección no encajan con la cámara del lab, ajustar:
    ```bash
    curl -X PUT http://localhost:8080/api/config/counting \
      -H "Content-Type: application/json" \
      -d '{"count_mode":"vertical","threshold":360,"direction":"top2down","confidence_threshold":0.5}'
    ```

---

## Group 5: Debugging si algo falla

25. **Sync no upserta el library model:** verificar que `sync.py` incluye `source` en la respuesta y que `sync_pull.py` lo lee correctamente. Probar el endpoint directo: `curl -H "X-API-Key: ..." http://server:9090/api/sync/models | jq`.

26. **Worker no carga `yolo11n.pt`:**
    - Probar manualmente desde el robot: `cd /opt/robot-platform/inference && uv run python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"`. Debe descargar el `.pt` la primera vez.
    - Si falla por permisos de escritura del cache de ultralytics, definir `YOLO_CONFIG_DIR` en el `.env.robot` apuntando a un directorio escribible.

27. **El picker no muestra "Persona":** el `class_mapping` JSON está mal formado. Editar el modelo desde `ModelsPage` (PATCH) y volver a guardar el JSON.

28. **El conteo no incrementa:** bajar `confidence_threshold` a `0.3` vía `PUT /api/config/counting`. Si sigue sin funcionar, abrir issue separado contra `back/services/perception/counter.py` — fuera del scope de esta fase.
