# Robot Platform - Plan de Modulos

## Estado actual

Lo que ya funciona:
- Streaming de video WebRTC (ZED 2i, canal izquierdo, 1280x720)
- Deteccion de objetos YOLO 11n sobre cada frame
- Toggle on/off del procesamiento desde el frontend
- Frontend basico (HTML/JS) con start/stop/toggle

Lo que NO se usa todavia:
- Canal derecho de la camara (stereo)
- Profundidad (ZED 2i tiene depth sensing)
- IMU del ZED 2i
- No hay control de actuadores/motores
- No hay canal de datos WebRTC (solo video)
- No hay persistencia ni logging estructurado
- El directorio `front/` esta vacio

---

## Modulos propuestos

### 1. Perception (back/services/perception/)

Responsable de todo lo que el robot "ve y entiende".

```
back/services/perception/
    __init__.py
    detector.py        # YOLO - deteccion de objetos (ya existe como processing.py)
    depth.py           # Mapa de profundidad usando stereo del ZED 2i
    tracker.py         # Tracking de objetos entre frames (ByteTrack/BoTSORT)
```

**detector.py** (evolucion de processing.py)
- Modelo YOLO configurable (yolo11n, yolo11s, modelo custom)
- Retorna tanto el frame anotado como los resultados estructurados (clase, confianza, bbox, conteo)
- Soporte para modelos entrenados a medida (e.g. piezas industriales, herramientas)

**depth.py**
- Usa ambos canales del ZED 2i (izquierdo + derecho)
- Genera mapa de profundidad (disparity map con OpenCV o ZED SDK)
- Permite obtener distancia estimada a objetos detectados
- Combinado con detector: "objeto X esta a Y metros"

**tracker.py**
- Asigna IDs persistentes a objetos entre frames
- Permite contar objetos que entran/salen de una zona
- Historial de trayectorias

---

### 2. Data Channel (back/services/datachannel.py)

Canal de datos WebRTC paralelo al video para enviar informacion estructurada al frontend en tiempo real.

```python
# Datos que se enviarian por frame:
{
    "frame_id": 1234,
    "timestamp": 1706900000.123,
    "detections": [
        {"class": "person", "confidence": 0.92, "bbox": [100, 200, 300, 400]},
        {"class": "cup", "confidence": 0.87, "bbox": [500, 300, 600, 450]}
    ],
    "counts": {"person": 1, "cup": 1},
    "depth_avg": 2.3,        # metros (si depth esta activo)
    "processing_ms": 18.5    # latencia del procesamiento
}
```

Cambios necesarios:
- En `stream.py` `/offer`: crear DataChannel en el RTCPeerConnection
- En `camera.py` `recv()`: enviar JSON por el datachannel despues de cada frame
- En el frontend: escuchar `ondatachannel` y mostrar la info en un overlay

---

### 3. Control (back/services/control/)

Interfaz para controlar actuadores del robot.

```
back/services/control/
    __init__.py
    motors.py          # Control de motores (GPIO, serial, CAN bus)
    servos.py          # Control de servos (pan-tilt de camara, brazos)
    commands.py        # Cola de comandos y ejecucion
```

**motors.py**
- Abstraccion sobre el hardware de motores (adaptable a GPIO, serial, controladora)
- Comandos: avanzar, retroceder, girar, parar
- Velocidad configurable
- Safety: timeout automatico si no recibe comandos (watchdog)

**servos.py**
- Control de pan/tilt para la camara
- Posiciones predefinidas (home, scan)

**commands.py**
- Cola de comandos con prioridad
- Comando de emergencia (STOP) que cancela todo
- Validacion de comandos antes de ejecutar

Rutas nuevas:
```
POST /control/move      {"direction": "forward", "speed": 0.5, "duration": 1.0}
POST /control/stop      {}
POST /control/servo     {"pan": 45, "tilt": -10}
GET  /control/status    -> estado de motores, bateria, etc.
```

Alternativa: enviar comandos por DataChannel WebRTC para menor latencia.

---

### 4. Frontend (front/)

Reemplazar el HTML estatico por una app con componentes.

```
front/
    index.html
    css/
        styles.css
    js/
        app.js              # Logica principal
        webrtc.js           # Conexion WebRTC
        datachannel.js      # Manejo del data channel
        controls.js         # Joystick virtual / botones de movimiento
        overlay.js          # Overlay de detecciones sobre el video
```

Funcionalidades:
- **Video stream** con overlay de detecciones (bboxes, labels, conteos)
- **Panel de info** en tiempo real: FPS, latencia, objetos detectados, distancia
- **Controles de movimiento**: joystick virtual o botones WASD
- **Selector de modelo**: cambiar modelo YOLO en runtime
- **Configuracion de camara**: toggle stereo, toggle depth overlay
- **Log/consola**: ver mensajes del servidor

---

### 5. Config (back/config.py)

Centralizacion de configuracion en lugar de constantes dispersas.

```python
# back/config.py
from dataclasses import dataclass

@dataclass
class CameraConfig:
    index: int = 2
    frame_width: int = 2560
    frame_height: int = 720
    crop_width: int = 1280
    stereo: bool = False          # usar ambos canales

@dataclass
class ProcessingConfig:
    model_path: str = "yolo11n.pt"
    enabled: bool = True
    confidence_threshold: float = 0.5
    device: str = "auto"         # "cpu", "cuda", "auto"

@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8080

@dataclass
class Config:
    camera: CameraConfig = CameraConfig()
    processing: ProcessingConfig = ProcessingConfig()
    server: ServerConfig = ServerConfig()
```

Cargable desde archivo YAML o variables de entorno.

---

### 6. Recording (back/services/recording.py)

Grabacion de sesiones para analisis posterior.

- Guardar video en disco (H.264/MP4) con timestamps
- Guardar log de detecciones en CSV/JSON
- Modo snapshot: guardar frame individual bajo demanda
- Util para: crear datasets de entrenamiento, debugging, evidencia

Rutas:
```
POST /recording/start
POST /recording/stop
POST /recording/snapshot
GET  /recording/list
```

---

## Prioridad sugerida

| Prioridad | Modulo | Justificacion |
|-----------|--------|---------------|
| 1 | Data Channel | Permite enviar detecciones al frontend sin cambios grandes |
| 2 | Perception (detector mejorado) | Retornar datos estructurados ademas del frame anotado |
| 3 | Config | Eliminar constantes hardcodeadas, facilita todo lo demas |
| 4 | Frontend mejorado | Mostrar la info del data channel, overlay de detecciones |
| 5 | Depth | Aprovechar la capacidad stereo del ZED 2i |
| 6 | Recording | Util para crear datasets y debugging |
| 7 | Control | Depende del hardware de actuadores disponible |

---

## Estructura final propuesta

```
robot-platform/
    back/
        __init__.py
        main.py
        config.py
        routes/
            __init__.py
            stream.py
            control.py
            recording.py
        services/
            __init__.py
            camera.py
            datachannel.py
            recording.py
            perception/
                __init__.py
                detector.py
                depth.py
                tracker.py
            control/
                __init__.py
                motors.py
                servos.py
                commands.py
    front/
        index.html
        css/
            styles.css
        js/
            app.js
            webrtc.js
            datachannel.js
            controls.js
            overlay.js
    plans/
    tests/
    pyproject.toml
```
