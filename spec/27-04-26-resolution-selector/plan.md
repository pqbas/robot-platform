# Plan: Selector de resolución desde el frontend

## Group 1: Camera worker — control socket + reload

1. En `camera_worker/camera_worker/main.py`, agregar argumento `--control-socket` (default `/tmp/camera-control.sock`, env `CAMERA_CONTROL_SOCKET`):
   - Espejear el patrón de `parse_args` en `recording_worker/recording_worker/main.py`.
   - Agregar `--settings-path` (default `data/robot/camera_settings.json`, env `CAMERA_SETTINGS_PATH`) — el path al JSON que define el preset activo.

2. En `camera_worker/camera_worker/main.py`, agregar `_load_preset(settings_path) -> dict` que:
   - Lee el JSON del settings file.
   - Si el archivo no existe o está corrupto, devuelve `{"preset": "1080p"}` (default seguro).
   - Mapea `"1080p"` → `(width=3840, height=1080, crop=1920)` y `"720p"` → `(width=2560, height=720, crop=1280)`.
   - Esos triples vienen de `camera_worker/README.md` (sección "Resolution modes").

3. En `camera_worker/camera_worker/main.py`, modificar `parse_args()` y `open_camera()` para que el preset cargado del JSON sobrescriba los env vars `CAMERA_WIDTH/HEIGHT/CROP` cuando el JSON existe. Si el JSON no existe, mantener el comportamiento actual (env vars como hoy).

4. En `FrameBroadcaster`, agregar un método `async def reload(self) -> None` que:
   - Marca un `_reload_event = asyncio.Event()` que el loop `_produce()` consume.
   - En `_produce()`, antes de cada `read_frame()`, chequea si `_reload_event.is_set()`: si sí, libera `self._cap`, vuelve a leer el preset del JSON, llama `open_camera(self._args)` con los nuevos parámetros, recalcula `out_width/out_height`, y limpia las queues de los clientes (drop frames).
   - Importante: cerrar las conexiones de clientes para forzar reconexión con handshake nuevo. Iterar sobre `self._clients` y poner un sentinel (`b""`) en cada queue; en `handle_client`, detectar el sentinel y romper el loop para cerrar el writer. Eso obliga al WebRTC backend y al recording-worker a reconectarse y recibir el handshake con las nuevas dimensiones.

5. En `camera_worker/camera_worker/main.py`, agregar `async def handle_control(reader, writer, broadcaster)` siguiendo el patrón de `recording_worker/main.py:handle_control`:
   - Comandos: `{"cmd": "reload"}` → llama `broadcaster.reload()`, devuelve `{"ok": true, "width": ..., "height": ..., "fps": ...}`.
   - `{"cmd": "status"}` → devuelve dimensiones actuales.
   - Cualquier otro: `{"ok": false, "error": "unknown_cmd"}`.

6. En `serve()`, levantar un segundo `asyncio.start_unix_server` para el control socket en paralelo al de frames. Mismo patrón que `recording_worker.serve()`.

7. En `camera_worker/README.md`, agregar sección "Control socket" documentando el path, los comandos, y el flujo de reload (todos los clientes se reconectan).

---

## Group 2: Backend — endpoint + persistencia + cliente del control socket

8. Crear `back/services/camera_settings.py` con:
   - `read_preset() -> str` que lee `data/robot/camera_settings.json` y devuelve el preset (default `"1080p"` si falta el archivo).
   - `write_preset(preset: str) -> None` que valida (`preset in {"1080p", "720p"}`) y escribe atómicamente (escribir a `.tmp` + `os.replace`).
   - El path se toma de un nuevo campo `StorageConfig.camera_settings_path` en `back/config.py` (default `data/robot/camera_settings.json`, env `CAMERA_SETTINGS_PATH`).

9. Crear `back/services/camera_control_client.py` con:
   - Función sincrónica `reload_camera_worker(socket_path: str = "/tmp/camera-control.sock") -> dict` que abre el control socket, manda `{"cmd": "reload"}` length-prefixed, lee la respuesta, y devuelve el dict. Mismo patrón length-prefixed que ya usa `back/services/recording_client.py` (revisar ese archivo para el helper exacto).
   - Path del socket: agregar `CameraConfig.control_socket_path` en `back/config.py` (default `/tmp/camera-control.sock`, env `CAMERA_CONTROL_SOCKET`).

10. En `back/schemas.py`, agregar:
    ```python
    class CameraResolutionOut(BaseModel):
        preset: Literal["1080p", "720p"]

    class CameraResolutionUpdate(BaseModel):
        preset: Literal["1080p", "720p"]
    ```

11. En `back/routes/config_routes.py`, agregar dos handlers:
    - `GET /api/config/camera/resolution` → devuelve `CameraResolutionOut` con el preset actual (lee `camera_settings.read_preset()`).
    - `PUT /api/config/camera/resolution` → valida el body, escribe el JSON con `write_preset()`, llama `reload_camera_worker()`, devuelve el preset confirmado. Si el control socket falla, devuelve 503 con detalle. Si `config.mode != AppMode.ROBOT`, devuelve 404 (mismo patrón que `device_context.py`).

12. En `back/services/recording_client.py` (o donde el backend orqueste el recording), revisar si una sesión activa de grabación bloquea el reload. Si la grabación está activa, el endpoint debe devolver 409 con un mensaje claro ("Detén la grabación antes de cambiar la resolución"). Idem si hay una sesión de conteo activa (`counter.get_active_session() is not None`).

---

## Group 3: Frontend — UI + API client

13. En `front/src/api/config.ts`, agregar:
    - `getCameraResolution(): Promise<{ preset: "1080p" | "720p" }>`
    - `setCameraResolution(preset: "1080p" | "720p"): Promise<{ preset: "1080p" | "720p" }>`
    Mismo patrón que las funciones que ya existan en `config.ts` para `/api/config/camera` y `/api/config/counting`.

14. Crear `front/src/hooks/useCameraResolution.ts`:
    - Estado: `preset: "1080p" | "720p" | null`, `loading`, `error`.
    - Carga inicial via `getCameraResolution()` al montar.
    - `change(preset)` que llama `setCameraResolution()`, actualiza estado local en éxito, muestra toast.

15. En `front/src/modules/vision/VisionPage.tsx`, agregar un control de resolución en la barra de configuración (línea ~182 del file actual, donde está el botón Settings). Opciones:
    - Un Select de shadcn (`@/components/ui/select`) con dos opciones "1080p" y "720p".
    - Disabled cuando `busy || isCounting || isRecording` con tooltip explicando por qué.
    - Estado: hook `useCameraResolution()`.
    - On change: llama `change(preset)`. Si `connectionState !== "disconnected"`, primero llamar `disconnect()` y avisar al operador con un toast ("Resolución cambiada — vuelve a conectar").

16. (Opcional, si encaja en la misma sesión) En `front/src/modules/vision/components/CountingConfigDialog.tsx`, agregar el mismo Select como segunda fila en el dialog. Si el inline ya cubre el flujo, omitir esto y dejar el dialog tal cual.

---

## Group 4: Compatibilidad recording-worker + WebRTC encoder

17. Verificar que `recording_worker/recording_worker/main.py:CameraReader.connect` maneja el escenario "el camera-worker cerró mi socket" — en `read_frame()` ya devuelve `None` y `encode_loop` finaliza el MP4 limpiamente (líneas 158-167). Confirmar que es seguro y no requiere cambios.

18. Verificar que `back/services/camera.py:CameraStreamTrack.recv` ante un `Camera read failed` para el track (línea 144-147) y la peer connection se cierra. El frontend ya maneja eso en `useWebRTC.ts:onconnectionstatechange`. No requiere cambios.

19. Verificar que `back/services/nvenc_codec.py` (encoder WebRTC) construye el pipeline con las dimensiones del primer frame que recibe. Como el encoder se construye al iniciar la peer connection nueva (no se reutiliza tras el cierre), recibe el frame con la nueva resolución y ajusta el pipeline correctamente. Confirmar leyendo `_build_pipeline` en `nvenc_codec.py`. Si no, hay que invalidar el encoder al cerrar la track.

---

## Group 5: Documentación

20. Actualizar `camera_worker/README.md`:
    - Reemplazar la sección "720p (troubleshooting fallback)" para apuntar al toggle del frontend en vez de "override en `.env.robot`".
    - Mantener documentadas las dimensiones exactas (CAMERA_WIDTH/HEIGHT/CROP) como referencia técnica para soporte.
    - Documentar el path `data/robot/camera_settings.json`, su shape, y que el camera-worker lo lee al arrancar y al recibir `{"cmd":"reload"}` por el control socket.

21. Actualizar `recording_worker/README.md` si menciona el override de `.env.robot` para 720p — alinear el wording con que ahora se cambia desde el frontend.

22. Actualizar `CLAUDE.md` (sección Camera Worker): mencionar el control socket nuevo y `camera_settings.json` en la línea de troubleshooting.
