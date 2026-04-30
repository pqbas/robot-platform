# Plan: Inferencia YOLO con TensorRT

## Group 1: Conversion worker (proyecto nuevo)

1. Crear `conversion_worker/pyproject.toml` siguiendo el formato de `recording_worker/pyproject.toml`:
   - `name = "conversion-worker"`, `requires-python = ">=3.10"`.

   - Dependencies: `ultralytics>=8.4.11`, `numpy`. 

   - **No** `tensorrt`: viene del sistem (JetPack) o de un venv con
     `--system-site-packages`.

   - `[project.scripts]` → `conversion-worker = "conversion_worker.main:main"`.

2. Crear `conversion_worker/conversion_worker/__init__.py` (vacío) y
   `conversion_worker/conversion_worker/converter.py`:

   - `def convert(pt_path: str, engine_path: str, precision: str = "fp16") -> None`.

   - Carga `YOLO(pt_path)`, llama `model.export(format="engine",
     half=(precision=="fp16"), imgsz=640)`.

   - `model.export()` deja el `.engine` junto al `.pt` con nombre default; renombrar al
     `engine_path` recibido.

   - Borra el `.onnx` intermedio que ultralytics genera (no lo necesitamos en cache).

   - Loguea start, end, duración total. No captura excepciones: el caller (main.py)
     decide qué hacer.

3. Crear `conversion_worker/conversion_worker/main.py`:

   - Asyncio control socket en `/tmp/conversion.sock`, length-prefixed JSON
     request/response, copiar el shape de `recording_worker/recording_worker/main.py`
     (`_recv_msg`, `_send_msg`, `handle_client`).

   - State machine `idle | converting`. Solo una conversión a la vez.

   - Comandos: `convert` (arranca un thread con `converter.convert()`, retorna
     inmediato; estado pasa a `converting`), `status` (devuelve `state`, `current` con
     `pt_path`, `started_at`, `last_result` con `ok | error`).

   - Cuando el thread termina, actualiza `last_result` y vuelve a `idle`. El backend lo
     recoge en el siguiente `status`.

   - Maneja SIGTERM/SIGINT como `recording_worker` (`stop` event → cierra socket, sale
     clean).

4. Crear `conversion_worker/README.md`:
   - Cómo instalar en Jetson (apt deps de JetPack: `python3-libnvinfer`, `python3-libnvinfer-dev`).
   - Cómo crear el venv con `uv venv --system-site-packages` para heredar `tensorrt`.
   - Por qué el `.engine` no es portable.
   - Ejemplo de invocación manual de `converter.convert()` para debugging.

5. Agregar `Makefile` target `run-conversion`:
   - `cd conversion_worker && uv run conversion-worker --control-socket /tmp/conversion.sock`.
   - Agregar `logs-conversion` y referencia en `.PHONY` siguiendo el patrón de `run-recording`/`logs-recording`.

6. Crear `deploy/conversion-worker.service` calcando `deploy/recording-worker.service`:
   - Description, `ExecStart=/opt/robot-platform/conversion_worker/.venv/bin/conversion-worker`.
   - `ExecStartPre=/bin/rm -f /tmp/conversion.sock`.
   - `Environment=CONVERSION_SOCKET=/tmp/conversion.sock`.

7. Actualizar `deploy/install_robot.sh` (o equivalente que setea los workers) para crear el venv en `conversion_worker/` con `uv venv --system-site-packages` y registrar el service nuevo.

---

## Group 2: Backend — DB + cliente del worker

8. Migración Alembic en `back/alembic/versions/` agregando 3 columnas a `detection_models`:
   - `tensorrt_enabled BOOLEAN NOT NULL DEFAULT 0`.
   - `engine_status TEXT NOT NULL DEFAULT 'pytorch'`.
   - `engine_error TEXT NULL`.
   - Numerar siguiente al `004_simplify_model_schema.py` existente.

9. Editar `back/models.py`, clase `DetectionModel`:
   - Agregar las 3 columnas (espejo de la migración).

10. Crear `back/services/perception/conversion_client.py` calcando `back/services/perception/inference_client.py`:
    - Clase `ConversionClient(socket_path)`.
    - Métodos: `convert(pt_path, engine_path, precision="fp16")`, `status()`.
    - Mismo manejo de reconnect/disconnect que `InferenceClient`.

11. En `back/config.py`, agregar al `PerceptionConfig` o crear un `ConversionConfig`:
    - `socket_path: str = os.getenv("CONVERSION_SOCKET", "/tmp/conversion.sock")`.

12. Crear helper `back/services/perception/engine_paths.py`:
    - `def engine_path_for(pt_path: str, file_hash: str) -> str` → `<dir>/<stem>.<hash>.fp16.engine`.
    - `def engine_exists(pt_path, file_hash)` → `os.path.exists(engine_path_for(...))`.

---

## Group 3: Backend — endpoints y reconciliación de estado

13. Crear `back/routes/models_local.py`, prefix `/api/models`, robot-only
    (`_require_robot_mode()` igual que `config_routes.update_camera_resolution`):

    - `GET /api/models` → lista de `DetectionModel` asignados al device actual (join con
      `device_models` por `get_device_id()`), proyectando `uuid, filename,
      tensorrt_enabled, engine_status, engine_error`.

    - `PUT /api/models/{uuid}/tensorrt` body `{enabled: bool}`:

      - Si `enabled=true`:
        - Si `engine_exists()` → DB `tensorrt_enabled=true, engine_status='ready'`.
          Retorna.
        - Else: chequear que no haya otra conversión activa
          (`ConversionClient.status()`); si la hay → 409 "Conversión en curso".
        - Resolver `pt_path` y `engine_path`, llamar `ConversionClient.convert(...)`. DB
          `tensorrt_enabled=true, engine_status='converting'`.

      - Si `enabled=false`: DB `tensorrt_enabled=false, engine_status='pytorch'`. No tocar el `.engine` en disco.

14. Registrar el router nuevo en `back/main.py` (donde están los `include_router` actuales).

15. Reconciliación al arranque: en `back/main.py` startup event, leer todos los
    `DetectionModel` asignados con `engine_status='converting'`. El worker ya no los
    está convirtiendo (acaba de arrancar el backend), así que setearlos a `error` con
    mensaje "Backend reiniciado durante conversión". Evita estados huérfanos.

16. Background poller en `back/main.py` startup (asyncio task):

    - Cada 5s, si hay algún modelo con `engine_status='converting'`, llama
      `ConversionClient.status()`.

    - Si el worker reporta `state=idle, last_result.ok=true` → marcar el modelo como
      `ready`. Si era el modelo actualmente activo en el inference-worker (compararlo
      contra `InferenceClient.status()`), llamar
      `InferenceClient.reload_model(engine_path)`.

    - Si `last_result.ok=false` → marcar `engine_status='error',
      engine_error=<mensaje>`.

17. Editar `back/routes/config_routes.py`, `select_label`:
    - Si el modelo seleccionado tiene `tensorrt_enabled=true and engine_status='ready'`, pasar el `engine_path` al `InferenceClient.reload_model`. Else el `pt_path` actual.

---

## Group 4: Frontend — UI en /settings

18. Crear `front/src/api/models.ts`:
    - Tipo `LocalModel = { uuid, filename, tensorrt_enabled, engine_status: 'pytorch'|'pending'|'converting'|'ready'|'error', engine_error: string|null }`.
    - `getLocalModels(): Promise<LocalModel[]>` → `GET /api/models`.
    - `setTensorRT(uuid, enabled): Promise<{engine_status: string}>` → `PUT /api/models/{uuid}/tensorrt`.

19. Crear `front/src/modules/settings/components/AssignedModelsCard.tsx`:
    - Card con título "Modelos asignados".
    - useEffect inicial: `getLocalModels()`.
    - Para cada modelo, fila con: `filename`, toggle (Switch de shadcn), badge de estado, mensaje de error si aplica, botón "Reintentar" si `engine_status='error'`.
    - Si hay algún modelo en `pending|converting`, polling cada 5s (`setInterval` con cleanup).
    - Toggle handler: optimistic update, llama `setTensorRT`, en 409 muestra toast "Conversión en curso, espera a que termine" y revierte.

20. Editar `front/src/modules/settings/SettingsPage.tsx`:
    - Importar y renderizar `<AssignedModelsCard />` debajo de la card existente "Detección".
    - Visible solo en modo robot (igual que el selector de resolución existente, hay un guard que ya se puede reusar).

---

## Group 5: Documentación

21. Actualizar `CLAUDE.md` raíz:
    - Sección nueva "Conversion Worker" describiendo: proyecto uv en `conversion_worker/`, control socket `/tmp/conversion.sock`, requiere `tensorrt` del sistema (JetPack), idle = 0 GPU.
    - Agregar a "Comandos" la línea `make run-conversion` y a "Logs" `make logs-conversion`.

22. Actualizar `spec/roadmap.md`, Phase 11:
    - Marcar las 4 cajas como `[x]` cuando todo lo de arriba pase validación.
