# Plan: IP camera source (RTSP)

Todos los cambios estan en `camera_worker/camera_worker/main.py` salvo el paso de settings.

## Group 1: Args y configuracion

1. En `parse_args()`, agregar argumento `--rtsp-url` con default `os.getenv("CAMERA_RTSP_URL", "")`.

2. En `_load_preset_override()`, ademas de leer `preset`, leer el campo `rtsp_url` del JSON. Retornar un dict que incluya `rtsp_url` si esta presente. Actualizar `_apply_override()` para asignar `args.rtsp_url`.

---

## Group 2: Apertura de camara

3. Refactorizar `open_camera(args)` en dos ramas:
   - Si `args.rtsp_url` es no vacio: `cv2.VideoCapture(args.rtsp_url)`. No configurar FOURCC ni BUFFERSIZE. Forzar `crop = 0` en `args` para este path.
   - Si no: comportamiento actual (V4L2 con `args.index`, FOURCC YUYV, BUFFERSIZE 1).
   - En ambas ramas: leer `actual_width`, `actual_height`, `actual_fps` del objeto `cap` y retornar la misma tupla `(cap, actual_width, actual_height, actual_fps)`.

4. En `FrameBroadcaster._produce()`, la funcion interna `reopen()` llama a `open_camera(self._args)` sin cambios; hereda la nueva logica automaticamente.

---

## Group 3: Logging y documentacion minima en camera_worker

5. En `open_camera`, agregar log `INFO` que indique la fuente abierta:
   - V4L2: `"Camera opened (index=%d) — actual %dx%d @ %.1ffps fourcc=%s"` (ya existe, no cambiar).
   - RTSP: `"Camera opened (rtsp=%s) — actual %dx%d @ %.1ffps"`.

6. Actualizar `camera_worker/README.md` (si existe seccion de configuracion) con el nuevo campo `rtsp_url` en el JSON de settings y la variable de entorno `CAMERA_RTSP_URL`.

---

## Group 4: Backend — API para configurar rtsp_url desde el servidor

7. En `back/services/camera_settings.py`, refactorizar `write_preset()` para que preserve los demas campos del JSON al escribir (leer el archivo actual, merge, y escribir). Agregar `read_rtsp_url() -> str` y `write_rtsp_url(url: str) -> None` que leen/escriben el campo `rtsp_url` del mismo JSON (`data/robot/camera_settings.json`).

8. En `back/schemas.py`, agregar:
   ```python
   class CameraSourceOut(BaseModel):
       rtsp_url: str

   class CameraSourceUpdate(BaseModel):
       rtsp_url: str
   ```

9. En `back/routes/config_routes.py`, agregar `GET /api/config/camera/source` y `PUT /api/config/camera/source` (robot-only, misma guarda `_require_robot_mode()`). El PUT escribe `rtsp_url` via `camera_settings.write_rtsp_url()` y luego envia `{"cmd": "reload"}` via `CameraControlClient`, igual que `update_camera_resolution`. Importar los nuevos schemas.

---

## Group 5: Frontend — campo en Settings para configurar la fuente

10. En `front/src/api/config.ts`, agregar:
    ```typescript
    export type CameraSource = { rtsp_url: string }
    export function getCameraSource(): Promise<CameraSource> { ... }
    export function setCameraSource(rtsp_url: string): Promise<CameraSource> { ... }
    ```
    Usando `apiFetch("/api/config/camera/source", ...)`.

11. En `front/src/modules/settings/SettingsPage.tsx`:
    - Agregar estado `draftRtspUrl: string` inicializado con `getCameraSource()` en el mismo `useEffect` que carga la config de camara (o en uno propio).
    - Agregar campo en la seccion "camera" (justo debajo del selector de resolucion): un `<Input>` con label "Fuente de video" y placeholder `rtsp://192.168.0.x:554/stream`. Cuando el campo esta vacio, se muestra un hint "Deja en blanco para usar la camara USB".
    - En `handleSave`, si `draftRtspUrl` cambio respecto al valor cargado, llamar `setCameraSource(draftRtspUrl)`.
    - Solo mostrar el campo en robot mode (`mode === "robot"`).

