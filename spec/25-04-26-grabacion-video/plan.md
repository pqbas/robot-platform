# Plan: Grabación de video

## Group 1: Camera worker — refactor a fan-out

1. Refactor `camera_worker/camera_worker/main.py` para abrir la cámara **una sola vez** y repartir frames a múltiples clientes:
   - Crear clase `FrameBroadcaster` con:
     - `_cap: cv2.VideoCapture | None`, `_width`, `_height`, `_out_width`, `_out_height`.
     - `_clients: list[asyncio.Queue[bytes]]` con maxsize=2 por cliente.
     - `start(args)`: abre la cámara con `open_camera(args)` (mover la función fuera del handler), arranca task `_produce`.
     - `_produce()`: loop que lee frames vía `loop.run_in_executor(None, read_frame)`, crop, `tobytes()`, push a cada cola con drop-oldest si está llena.
     - `add_client() -> asyncio.Queue`: registra y devuelve la cola.
     - `remove_client(q)`: la quita de la lista.
   - Reemplazar `handle_client` para que NO abra cámara: hace handshake con `out_width/out_height/3`, llama `add_client`, drena la cola al socket, llama `remove_client` al cerrarse.
   - En `serve(args)`: instanciar `FrameBroadcaster`, llamar `await broadcaster.start(args)` antes del `start_unix_server`.
   - Manejo de cámara desconectada en `_produce`: si `cap.read()` falla, soltar el `cap`, reintentar `open_camera` en loop sin matar las colas existentes (los clientes ven gap pero el socket sigue vivo).

2. Probar fan-out manualmente:
   - Levantar camera-worker, conectar dos clientes nc/socat distintos, verificar que ambos reciben los mismos frames.

---

## Group 2: Recording worker — proyecto uv nuevo

3. Crear `recording_worker/` con estructura espejo de `camera_worker/`:
   - `recording_worker/pyproject.toml` con dependencias base: `av`, `numpy`.
   - Dependencia opcional `pygobject` (para gstreamer) declarada como extra `[gstreamer]` — el venv del Jetson la instala vía `uv sync --extra gstreamer`. En laptop dev sin GPU NVIDIA se omite y el worker cae al backend PyAV/libx264.
   - Script entry: `recording-worker = "recording_worker.main:main"`.
   - `recording_worker/recording_worker/__init__.py` (vacío).

4. Implementar selección de backend en `recording_worker/recording_worker/encoder.py` (módulo nuevo):
   - Función `detect_backend() -> str` que prueba en orden, **igual** patrón que `back/services/nvenc_codec.py:detect_backend`:
     1. `nvv4l2h264enc` (Jetson) — vía `Gst.ElementFactory.find("nvv4l2h264enc")`.
     2. `h264_nvenc` (desktop NVIDIA) — vía `av.CodecContext.create("h264_nvenc", "w")` con probe de 64x64.
     3. `libx264` (fallback puro CPU).
   - Tres clases `Encoder` con interfaz común: `start(uuid, output_path, width, height, fps)`, `write_frame(frame: np.ndarray)`, `stop() -> dict` (devuelve `duration_seconds`, `file_size_bytes`, `width`, `height`, `fps`):
     - `GstMp4Encoder` — pipeline para grabación con sink de archivo:
       ```
       appsrc name=src is-live=true format=time do-timestamp=true
         caps=video/x-raw,format=BGR,width=W,height=H,framerate=30/1
         ! videoconvert
         ! nvv4l2h264enc bitrate=4000000 preset-level=1 profile=0 control-rate=1 iframeinterval=60
         ! h264parse
         ! mp4mux
         ! filesink location=<output_path>
       ```
       Push de frames vía `appsrc.emit("push-buffer", buf)` igual que en `nvenc_codec.py:GstNvencEncoder._encode_frame` (líneas 222-230). Diferencia clave: el sink es `filesink`, no `appsink` — los datos H.264 ya quedan multiplexados a MP4 directo en disco. El stop hace `appsrc.emit("end-of-stream")` y espera EOS antes de `set_state(NULL)` para que `mp4mux` cierre el moov atom correctamente.
     - `PyAvEncoder` — `av.open(output_path, mode="w")`, `container.add_stream("h264_nvenc" | "libx264", rate=fps)`, `pix_fmt="yuv420p"`. Usado tanto para `h264_nvenc` (desktop) como `libx264` (fallback).
   - El módulo `encoder.py` expone `make_encoder() -> Encoder` que lee `detect_backend()` y devuelve la clase correcta.

5. Implementar `recording_worker/recording_worker/main.py`:
   - `parse_args()`: `--camera-socket` (default `/tmp/camera.sock`), `--control-socket` (default `/tmp/recording.sock`).
   - Al arranque: log del backend detectado (info nivel: "Recording worker — backend=nvv4l2h264enc").
   - Cliente del camera socket: copia simplificada de `back/services/camera_client.py` — handshake (recibe width/height/channels), bucle de frames length-prefixed. **No se conecta hasta recibir comando `start`** (idle = cero CPU, cero conexión).
   - Servidor del control socket: `start_unix_server` con `handle_command(reader, writer)`:
     - Lee 4 bytes len + JSON.
     - Switch sobre `cmd`:
       - `start`: si idle → conecta al camera socket, lee handshake, llama `make_encoder().start(uuid, output_path, width, height, fps)`, arranca task `_encode_loop`. Devuelve `{ok, state, uuid, started_at, backend}`. Si ya recording → `{ok: false, error: "already_recording"}`.
       - `stop`: si recording → señala fin al `_encode_loop` (cierre limpio del pipeline gstreamer con EOS, o `container.close()` para PyAV), hace `os.stat` para `file_size_bytes`, devuelve `{duration_seconds, file_size_bytes, width, height, fps, backend}`.
       - `status`: devuelve estado actual.
     - Responde length-prefixed JSON.
   - `_encode_loop`: lee frames del camera socket vía `loop.run_in_executor`, llama `encoder.write_frame(frame)`. Cuenta frames para reportar FPS efectivo al stop.
   - Si el camera socket cierra mid-recording: finaliza pipeline limpiamente y vuelve a idle. Estado expuesto en próximo `status` poll del backend.
   - `signal.SIGTERM`/`SIGINT`: si está grabando, intenta cerrar el archivo antes de salir.

6. Crear `recording_worker/README.md` corto: cómo arrancarlo, sockets, comandos JSON, backends soportados, cómo probar el backend manualmente (`uv run python -c "from recording_worker.encoder import detect_backend; print(detect_backend())"`).

---

## Group 3: Backend — schema, migración y modelo

7. Añadir `Recording` a `back/models.py` después de `FrameDetection`:
   ```python
   class Recording(Base):
       __tablename__ = "recordings"
       uuid: Mapped[str] = mapped_column(Text, primary_key=True, default=_new_uuid)
       device_id: Mapped[str] = mapped_column(Text, default=get_device_id)
       session_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
       started_at: Mapped[str] = mapped_column(Text, nullable=False)
       ended_at: Mapped[str | None] = mapped_column(Text, nullable=True)
       duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
       file_path: Mapped[str] = mapped_column(Text, nullable=False)
       file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
       width: Mapped[int | None] = mapped_column(Integer, nullable=True)
       height: Mapped[int | None] = mapped_column(Integer, nullable=True)
       fps: Mapped[float | None] = mapped_column(Float, nullable=True)
       uploaded_at: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

8. Crear `back/alembic/versions/008_recordings.py` siguiendo el patrón de `007_device_fundo.py`:
   - `revision = "008"`, `down_revision = "007"`.
   - `op.create_table("recordings", ...)` con primary key `uuid` y todos los campos del modelo.
   - Downgrade: `op.drop_table("recordings")`.

9. Añadir a `back/config.py`:
   - En `StorageConfig`: `recordings_dir: str = os.getenv("RECORDINGS_DIR", "data/robot/recordings")`.
   - Nuevo `@dataclass RecordingConfig` con `control_socket_path: str = os.getenv("RECORDING_SOCKET", "/tmp/recording.sock")` y agregarlo a `Config`.

10. En `back/database.py:init_db`, asegurar `os.makedirs(config.storage.recordings_dir, exist_ok=True)`.

---

## Group 4: Backend — cliente del recording-worker

11. Crear `back/services/recording_client.py` siguiendo `camera_client.py`:
    - Clase `RecordingClient` con `_socket_path: str`.
    - Método `_send_command(cmd: dict, timeout=5.0) -> dict`:
      - Conecta al socket (one-shot por comando — los comandos son raros, no merece pool).
      - Manda 4 bytes len + JSON.
      - Lee 4 bytes len + JSON, parsea, devuelve.
      - Cierra socket.
    - Métodos públicos: `start(uuid, output_path) -> dict`, `stop() -> dict`, `status() -> dict`.
    - Manejo de errores: si el socket no existe (worker caído), lanza `RecordingWorkerUnavailable`.

12. Crear schemas Pydantic en `back/schemas.py` (sección nueva al final):
    ```python
    class RecordingOut(BaseModel):
        uuid: str
        device_id: str
        session_uuid: str | None
        started_at: str
        ended_at: str | None
        duration_seconds: float | None
        file_path: str
        file_size_bytes: int | None
        width: int | None
        height: int | None
        fps: float | None
        uploaded_at: str | None
        model_config = {"from_attributes": True}
    ```

---

## Group 5: Backend — REST endpoints

13. Crear `back/routes/recordings.py`:
    - `router = APIRouter(prefix="/api/recordings", tags=["recordings"])`.
    - `POST /start` (modo robot, sin auth):
      1. Verifica que no haya ninguna grabación con `ended_at IS NULL` para este device → 409.
      2. Genera `uuid`, calcula `output_path = config.storage.recordings_dir + f"/{uuid}.mp4"`, mira si hay sesión activa con `counter.get_active_session()` para popular `session_uuid`.
      3. Llama `RecordingClient(...).start(uuid, output_path)`. Si el worker dice `already_recording`, log error y 500 (estado inconsistente — el backend no sabía pero el worker sí).
      4. Crea fila `Recording` con `started_at = _now_iso()`, commit.
      5. Devuelve la fila.
    - `POST /stop`:
      1. Busca fila con `ended_at IS NULL`. Si no hay → 409.
      2. Llama `RecordingClient(...).stop()`. Lee `duration_seconds`, `file_size_bytes`, `width`, `height`, `fps`.
      3. Setea `ended_at = _now_iso()` + los campos del worker en la fila, commit.
      4. Devuelve la fila.
    - `GET /` → `select(Recording).order_by(Recording.started_at.desc())`.
    - `GET /{uuid}/file`:
      - 404 si no existe la fila o el archivo en disco.
      - `StreamingResponse(open(path, "rb"), media_type="video/mp4")` (FastAPI maneja chunks).
    - `DELETE /{uuid}`:
      - Borra fila + `os.unlink(path)` con try/except (ignorar FileNotFoundError).

14. Registrar el router en `back/main.py` junto a los demás (`app.include_router(recordings.router)`).

---

## Group 6: Backend — sync de metadata

15. En `back/services/sync_push.py:push_all`, añadir `("recordings", Recording)` después de `("sessions", Session)`. Importar `Recording` arriba.

16. En `back/services/sync_receive.py`, añadir `receive_recordings(db, items, device_id)`:
    - Skip si ya existe por uuid.
    - Validar `device_id` igual al autenticado.
    - **No** validar que `session_uuid` exista en server (asociación informativa). Si no resuelve, guardar igual.
    - Popular `successful_uuids` en el resultado (Phase 5 fix).

17. Añadir `POST /api/sync/recordings` en `back/routes/sync.py`. Mismo patrón que `POST /api/sync/sessions`.

---

## Group 7: Backend — upload del blob

18. Añadir `POST /api/sync/recordings/{uuid}/upload` en `back/routes/sync.py`:
    - Auth: device API key.
    - 404 si la fila no existe o no pertenece al device autenticado.
    - 409 si `uploaded_at` ya está set.
    - `UploadFile = File(...)` — escribe a `<server_recordings_dir>/<uuid>.mp4` por chunks (`while chunk := await file.read(1_048_576): out.write(chunk)`), nunca todo en memoria.
    - Setea `uploaded_at = _now_iso()`, `file_path` (path local del server), `file_size_bytes`.

19. Crear `back/services/sync_recordings_upload.py`:
    - `upload_pending_recordings()`:
      1. Selecciona `Recording` con `uploaded_at IS NULL` AND `ended_at IS NOT NULL` AND `uuid IN (SELECT record_uuid FROM sync_log WHERE table_name='recordings')`.
      2. Para cada uno, abre el archivo en streaming y `aiohttp.FormData()` con `add_field("file", open(path, "rb"), filename=...)`.
      3. POST con device API key. Si 200 → marca `uploaded_at` con la respuesta.
      4. Una a la vez (no `asyncio.gather`); si una falla, log warning y continúa con la siguiente en el próximo ciclo.

20. Llamar `upload_pending_recordings()` desde `back/services/sync_loop.py:_sync_cycle` después de `push_all` y antes de `pull_models`.

---

## Group 8: Frontend — types, API y RecordingsPage

21. Añadir tipo `Recording` a `front/src/types/index.ts`:
    ```ts
    export type Recording = {
      uuid: string
      device_id: string
      session_uuid: string | null
      started_at: string
      ended_at: string | null
      duration_seconds: number | null
      file_path: string
      file_size_bytes: number | null
      width: number | null
      height: number | null
      fps: number | null
      uploaded_at: string | null
    }
    ```

22. Crear `front/src/api/recordings.ts`:
    - `startRecording(): Promise<Recording>`
    - `stopRecording(): Promise<Recording>`
    - `getRecordings(): Promise<Recording[]>`
    - `deleteRecording(uuid: string): Promise<void>`
    - `getRecordingFileUrl(uuid: string): string` → `/api/recordings/${uuid}/file`.

23. Crear `front/src/modules/recordings/RecordingsPage.tsx`:
    - Tabla con columnas: Inicio, Duración, Tamaño, Sesión asociada, Estado (✓ subido / ⏳ pendiente / ⚠ archivo perdido), Acciones.
    - `useEffect` polling cada 30s.
    - Descargar: `<a href={getRecordingFileUrl(uuid)} download={...}>`.
    - Borrar: `<Dialog>` de confirmación → `deleteRecording` → recarga lista.

24. Registrar ruta `/recordings` en `front/src/App.tsx` y entrada en `front/src/components/Sidebar.tsx` (visible en ambos modos).

---

## Group 9: Frontend — control desde VisionPage

25. Crear hook `front/src/hooks/useRecording.ts`:
    - State `{ recording: Recording | null, loading: boolean }`.
    - `start()`, `stop()` que llaman al API.
    - `useEffect` al montar: `getRecordings()` y mira si hay una con `ended_at IS NULL` (recovery tras refresh del browser); si la hay, la setea como activa.
    - Timer derivado de `started_at` para el badge REC.

26. Modificar `front/src/modules/vision/VisionPage.tsx`:
    - Importar `useRecording`.
    - Añadir botón en la action bar:
      ```tsx
      {!recording.recording ? (
        <Button variant="outline" onClick={recording.start} disabled={!connected}>
          <Circle className="size-4 fill-red-500 text-red-500" /> Grabar
        </Button>
      ) : (
        <Button variant="destructive" onClick={recording.stop}>Detener grabación</Button>
      )}
      ```
    - Badge "REC ●" parpadeante (top-right del video, abajo de los FPS) con `animate-pulse` y timer.
    - Toast al detener: `toast.success(\`Video guardado — \${dur} \${size}\`)`.

27. En `disconnect` de WebRTC: si hay grabación activa, llamar `recording.stop()` antes. El recording-worker se desconectará del camera socket de todas formas, pero hacerlo explícito mantiene el estado consistente.

---

## Group 10: Deploy y operación

28. Añadir comando `make run-recording` y `make logs-recording` al `Makefile`:
    - `run-recording`: `cd recording_worker && uv run recording-worker`.
    - `logs-recording`: `journalctl -u recording-worker -f`.

29. Crear systemd unit `deploy/recording-worker.service` (espejo de `camera-worker.service`):
    - `ExecStart=<repo>/recording_worker/.venv/bin/recording-worker`.
    - `Restart=on-failure`, `RestartSec=2`.
    - Depende de `camera-worker.service` (`After=`, `Wants=`).
    - Usuario: igual que el robot (`labinm-jetson`).

30. Actualizar el script de deploy del robot (`make deploy-robot` o el bash subyacente) para:
    - Crear el venv de `recording_worker/` con `uv sync --extra gstreamer` en Jetson (laptop dev usa `uv sync` plain).
    - Instalar y habilitar la unidad systemd.
    - `mkdir -p data/robot/recordings` con permisos correctos.

31. Verificación de plugins gstreamer del sistema en el script de deploy (Jetson only):
    - `pygobject` instalado vía `uv` no incluye los plugins nativos — éstos vienen del JetPack/sistema. El deploy debe fallar temprano si falta alguno crítico.
    - Añadir un check antes de habilitar la unidad systemd:
      ```bash
      REQUIRED_GST_ELEMENTS="nvv4l2h264enc videoconvert h264parse mp4mux filesink appsrc"
      for elem in $REQUIRED_GST_ELEMENTS; do
          if ! gst-inspect-1.0 "$elem" >/dev/null 2>&1; then
              echo "ERROR: gstreamer plugin '$elem' no encontrado."
              echo "  Instalar con: sudo apt install gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-tools"
              echo "  En Jetson: el plugin nvv4l2h264enc viene en nvidia-l4t-gstreamer (JetPack)."
              exit 1
          fi
      done
      echo "OK: todos los gstreamer plugins requeridos están instalados"
      ```
    - El `nvv4l2h264enc` específicamente requiere `nvidia-l4t-gstreamer` del JetPack — si no está, el robot operativamente no puede grabar con HW accel y caería al fallback `libx264` (ineficiente para Jetson). Mejor falla el deploy que descubrirlo en producción.
    - En laptop dev este check se salta (sólo se ejecuta si el target del deploy es robot/Jetson).

32. Actualizar `CLAUDE.md` (sección "Recording Worker" nueva): describir el proyecto uv, los dos sockets, comando para arrancarlo, aclarar que el backend NO importa `av` ni `gi`, y documentar la dependencia de los plugins gstreamer del sistema (no instalables vía uv).

---

## Group 11: Validación manual

33. Smoke test local (laptop):
    - `make run-camera` + `make run-inference` + `make run-recording` + `make run-robot` + `make run-front`.
    - Conectar cámara, click "Grabar" → badge REC y timer.
    - Esperar 30s, "Detener grabación" → toast con duración y tamaño.
    - Abrir `/recordings`, descargar MP4, abrir en VLC → reproduce ~30s.

34. Verificar grabar + contar simultáneo:
    - Iniciar conteo, después grabación → `session_uuid` se asocia.
    - Detener conteo → grabación sigue. Detener grabación → fila tiene `session_uuid` correcto.

35. Verificar resilencia del worker:
    - Iniciar grabación, `kill -9` al recording-worker → systemd lo reinicia. Backend sigue funcionando. Próximo `start` desde la UI funciona.
    - Iniciar grabación, desconectar cámara USB → recording-worker cierra MP4, queda reproducible. Backend descubre estado idle en próximo `status` poll (o al `stop` siguiente).

36. Verificar fan-out:
    - Backend conectado al WebRTC + recording-worker grabando simultáneamente → ambos reciben frames sin drops visibles (confirmar FPS de stream y FPS reportado por el worker).

37. Sync end-to-end:
    - Server local arriba, `.env.robot` con `SYNC_SERVER_URL`.
    - Grabar 10s, esperar ciclo de sync (bajar `SYNC_INTERVAL` a 30s para test).
    - En server `/recordings`: la grabación aparece con estado uploaded y descarga funciona.
