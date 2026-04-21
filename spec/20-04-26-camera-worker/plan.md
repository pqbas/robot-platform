# Plan: camera-worker

## Group 1: Camera worker process

1. Inicializar proyecto uv en `camera_worker/`:
   - `cd camera_worker && uv init --name camera-worker --no-workspace`
   - Agregar dependencias: `uv add opencv-python numpy`
   - Definir entry point en `camera_worker/pyproject.toml`:
     ```toml
     [project.scripts]
     camera-worker = "camera_worker.main:main"
     ```

2. Crear `camera_worker/camera_worker/main.py` — servidor Unix socket + loop de captura:
   - `parse_args()`: `--socket-path` (default `/tmp/camera.sock` vía `CAMERA_SOCKET`), `--index`, `--width`, `--height`, `--crop`
   - `main()`: limpia socket antiguo (`os.unlink` si existe), llama `asyncio.run(serve(args))`
   - `serve(args)`: abre `asyncio.start_unix_server(handle_client, path)`, instala handlers SIGTERM/SIGINT para shutdown limpio
   - `handle_client(reader, writer)`: envía handshake JSON, luego loop de captura → send frame; si `cap.read()` falla → cierra writer y retorna
   - `open_camera(args)` → `cv2.VideoCapture` con propiedades, reintentos cada 1s hasta éxito
   - Los frames se cropean aquí: `frame = frame[:, :args.crop] if args.crop > 0 else frame`
   - Protocolo send: `struct.pack(">I", frame_len) + frame.tobytes()`

---

## Group 2: Cliente en el backend

4. Crear `back/services/camera_client.py`:
   - Clase `CameraClient(socket_path: str)`
   - `_connect()`: abre `socket.socket(AF_UNIX, SOCK_STREAM)`, conecta, lee handshake JSON, guarda `width`, `height`, `channels`
   - `read_frame() -> np.ndarray`: lee `4 bytes` → frame_len, lee `frame_len bytes`, devuelve `np.frombuffer(...).reshape(height, width, channels).copy()`; en cualquier error llama `_disconnect()` e intenta `_connect()` una vez antes de re-raise
   - `close()`: cierra socket
   - Mismo patrón que `back/services/perception/inference_client.py`

5. Agregar `camera.socket_path` a `back/config.py`:
   ```python
   @dataclass
   class CameraConfig:
       index: int = ...
       frame_width: int = ...
       frame_height: int = ...
       crop_width: int = ...
       socket_path: str = field(default_factory=lambda: os.getenv("CAMERA_SOCKET", "/tmp/camera.sock"))
   ```

---

## Group 3: Reemplazar CameraStreamTrack

6. Reescribir `back/services/camera.py` — eliminar `cv2.VideoCapture`, `_camera_lock`, `time`, `_release_camera`, `_open_camera`, `_drain_and_read`. Mantener `_InferenceWorker` intacto.

7. Nuevo `CameraStreamTrack.__init__`:
   ```python
   def __init__(self):
       super().__init__()
       self._client = CameraClient(config.camera.socket_path)
       self._worker = _InferenceWorker()
       self._data_channel = None
       self.stopped = asyncio.Event()
   ```

8. Nuevo `CameraStreamTrack.recv()`:
   - `loop.run_in_executor(None, self._client.read_frame)` — bloquea hasta frame o excepción
   - Si excepción → `self.stop()`, raise
   - Lógica de crop, inference submit, data channel send, `av.VideoFrame` — igual que hoy
   - Arrancar `_worker` en el primer frame exitoso (como antes)

9. Nuevo `CameraStreamTrack.stop()`:
   ```python
   def stop(self):
       super().stop()
       self._worker.stop()
       self._client.close()
       self.stopped.set()
   ```

10. `back/routes/stream.py` — sin cambios (el watcher `_watch_track` con `asyncio.Event` ya está bien).

---

## Group 4: Deploy

11. Crear `deploy/camera-worker.service` siguiendo el template de `deploy/inference-worker.service`:
    ```ini
    [Unit]
    Description=Camera Worker (V4L2 via Unix socket)
    Before=robot-platform.service
    After=network.target

    [Service]
    Type=simple
    User=DEPLOY_USER
    WorkingDirectory=DEPLOY_DIR
    ExecStartPre=/bin/rm -f /tmp/camera.sock
    ExecStart=/opt/robot-platform/camera_worker/.venv/bin/camera-worker
    Restart=on-failure
    RestartSec=3
    Environment=CAMERA_SOCKET=/tmp/camera.sock

    [Install]
    WantedBy=multi-user.target
    ```

12. Actualizar `deploy/install.sh`: agregar instalación de `camera-worker.service` junto a `inference-worker.service`.

13. Actualizar `deploy/robot-platform.service`: agregar `After=camera-worker.service` y `Wants=camera-worker.service`.

14. Agregar targets en `Makefile`:
    ```makefile
    run-camera:
        cd camera_worker && uv run camera-worker

    logs-camera:
        sudo journalctl -u camera-worker -f
    ```

15. Actualizar `CLAUDE.md` (sección Comandos): agregar `make run-camera`.
