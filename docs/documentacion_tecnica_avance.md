---
title: DOCUMENTACIÓN TÉCNICA DE LA PLATAFORMA
subtitle: SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS
version: Avance 2
author: Percy Brayam Cubas Muñoz
date: 4 de mayo de 2026
location: Trujillo - Perú
month: MAYO - 2026
project_quote: ""Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú""
project_code: PE5010-86701-2024-PROCIENCIA
---

<!--
Fuente editable de la documentación técnica.
Compilar a docx con:  node docs/roadmap/generate_from_md.js

Sintaxis soportada:
  # / ## / ###      encabezados (heading1/2/3)
  párrafos          texto plano justificado, **bold** inline
  - item            bullet (admite **prefijo:** al inicio)
  1. item           lista numerada (cada bloque numerado reinicia su contador)
  | a | b |         tabla pipe markdown; primera fila = header
  | --- | --- |
  ^TABLA N. ...     leyenda de tabla o figura (centrada, gris, itálica)
  ::figure path     inserta imagen (ruta absoluta o relativa al repo)
  ![leyenda](path)  sintaxis markdown estándar; el texto entre [ ] se usa como
                    leyenda de la figura (puede llevar espacios y %20 en la ruta)
-->

# I. DESCRIPCIÓN DEL SISTEMA

La plataforma Robot Platform es el componente de software del robot móvil agrícola. Su
función principal es detectar, contar y clasificar frutos en tiempo real mientras el
robot recorre los camellones de un fundo agrícola. El operador interactúa con el sistema
desde un celular o tablet conectado a la red WiFi del robot, a través de una interfaz
web.

El sistema opera en dos modos diferenciados mediante la variable de entorno ROBOT_MODE.

- **Modo robot:** ejecuta en la computadora embebida del robot (NVIDIA Jetson Xavier).
  Este modo le permite al robot realizar las operaciones necesarias en campo (capturar
  video, detectar frutos mediante YOLO, grabar videos, clasificar frutos, etc).

- **Modo servidor:** ejecuta en una PC del laboratorio, y recibe datos sincronizados
  desde múltiples robots, gestiona los modelos YOLO integrados en los robots. 

Ambos modos comparten el mismo codebase del backend; la diferencia de comportamiento se
controla por la variable de entorno mencionada (robot o server).

# II. ARQUITECTURA

## Visión general

La Figura 1 presenta el diagrama de arquitectura del sistema en modo robot y la Tabla 1
detalla cada proceso. La arquitectura del sistema consiste en 5 procesos que se
comunican mediante sockets Unix. El cliente accede por nginx y recibe video por WebRTC;
la sincronización con el servidor central se realiza por HTTP.

::figure /home/pqbas/labinm/robot-platform/docs/diagrams/arquitectura_actual.png
^FIGURA 1. Arquitectura del sistema en modo robot. El backend (azul) coordina cuatro workers independientes: camera-worker (captura), inference-worker (YOLO/TensorRT), recording-worker (NVENC) y conversion-worker (build de engines TensorRT bajo demanda). .

<!-- widths: 2200,1400,5760 -->
| Proceso | Socket Unix | Responsabilidad |
| --- | --- | --- |
| Backend | HTTP :8080 | FastAPI + Uvicorn. API REST, WebRTC (aiortc), persistencia SQLite, sincronización HTTP. Coordina los workers. |
| camera-worker | /tmp/camera.sock | Captura V4L2 (ZED 2i estéreo SBS), crop al ojo izquierdo, fan-out a múltiples consumidores (backend WebRTC y recording simultáneos). |
| inference-worker | /tmp/inference.sock | Ultralytics YOLO v11 con tracking BotSort. Carga modelo .pt o engine .engine TensorRT FP16 según selección del operador. Recarga en caliente. |
| recording-worker | /tmp/recording.sock | Codifica el stream de cámara a H.264 con NVENC (Jetson nvv4l2h264enc, desktop h264_nvenc) o libx264 como fallback. Idle = 0 CPU mientras no hay grabación. |
| conversion-worker | /tmp/conversion.sock | Construye engines TensorRT FP16 a partir de modelos .pt cuando el operador activa TensorRT en /settings. Una conversión a la vez. |
^TABLA 1. Procesos del sistema en modo robot.

En modo servidor, el sistema ejecuta un único proceso (el backend), sin workers de captura ni inferencia. La Tabla 2 compara las funciones activas en cada modo.

| Robot (Jetson Xavier) | Servidor (PC del laboratorio) |
| --- | --- |
| ROBOT_MODE=robot, puerto 8080 | ROBOT_MODE=server, puerto 9090 |
| SQLite (aiosqlite) | PostgreSQL (psycopg async) |
| Captura de video, inferencia, grabación, conversión TensorRT | Autenticación JWT con roles |
| WebRTC streaming en tiempo real | Administración de modelos, usuarios y dispositivos |
| Sync push (envío de datos) y sync pull (descarga de modelos) | Recepción de sincronización y distribución de modelos |
| Sin autenticación (red local aislada) | Login con usuario y contraseña |
^TABLA 2. Funciones activas por modo de operación.


El flujo principal entre la cámara, el backend y la inferencia opera de la siguiente
manera:

1. **El camera-worker abre la cámara V4L2** una sola vez al recibir la primera conexión
   y publica un handshake JSON inicial con (width, height, channels, fps). A
   continuación entrega un stream de frames raw BGR length-prefixed.
2. **El backend lee frames del camera-worker,** los codifica como JPEG y los envía al
   inference-worker por /tmp/inference.sock junto con un JSON de configuración (clase
   objetivo, umbral de confianza).
3. **El inference-worker ejecuta YOLO** (PyTorch o TensorRT, según el modelo cargado)
   con tracking BotSort y responde un JSON con la lista de detecciones, los track_id y
   el conteo total.
4. **El backend reenvía las detecciones al frontend** por el data channel de WebRTC,
   donde se renderizan superpuestas al video.
5. **El recording-worker, si hay sesión activa,** se conecta de forma independiente al
   camera-worker y consume su propia copia del stream para encodear con NVENC sin pasar
   por el backend.

El backend también puede emitir comandos de control sobre los mismos sockets. Los más
relevantes son:

- **reload_model** hacia el inference-worker (carga un nuevo archivo de modelo sin
  reiniciar)
- **start, stop** hacia el recording-worker (controlan la grabación de la sesión)
- **convert** hacia el conversion-worker (encola un build TensorRT)
- **reload** hacia /tmp/camera-control.sock cuando el operador cambia la resolución desde el
  frontend

## Razones para la separación en procesos

La descomposición en backend más cuatro workers obedece a un conjunto de problemas
concretos identificados durante la integración.

- **Aislamiento de fallos,** debido a que un fallo del modelo o de la cámara dejaba el
  backend irrecuperable. Con procesos separados, systemd reinicia el worker sin afectar
  streaming ni API.

- **Desacoplamiento de tasas de frame,** debido a que la captura (20FPS-30FPS) e
  inferencia (12FPS-19FPS) operan a ritmos distintos, en un solo proceso los frames se
  acumulan en el buffer probocando que retardos en video; en procesos separados cada uno
  avanza a su ritmo sin acumulación.

- **Desacoplamiento del acceso a la cámara,** debido a que la api estandar del kernel de
  Linux (V4L2) no admite múltiples consumidores sobre una camara, el camera-worker abre
  el dispositivo una vez y reparte por colas al backend y al camera-recording.

- La separacion en workers busca una independencia de versiones entre los diferentes
  procesos, debido a que JetPack 5.1 solo entrega PyTorch CUDA y TensorRT para Python
  3.8, mientras el backend exige 3.13.

- **Costo cero en reposo,** debido a que recording-worker y conversion-worker no abren
  cámara ni cargan modelos hasta recibir un comando, liberando NVENC, GPU y memoria
  entre sesiones.

- **Recarga de modelo en caliente,** debido a que el inference-worker acepta
  reload_model y carga un nuevo .pt o .engine sin reiniciar, tras sincronización o
  conversión TensorRT.

- **Monitoreo independiente,** debido a que cada proceso es una unidad systemd con su
  propio journal es posible debugearlo sin interrumpir o afectar otro componente.


![FIGURA 2. Módulo de visión operando sobre el robot móvil. La detección (bounding box verde) y la línea de conteo se renderizan sobre el video transmitido por WebRTC. El stream sostiene 1080p a 30 FPS y la inferencia con Pytorch alcanza 12 FPS sobre la Jetson Xavier.](/home/pqbas/Downloads/WhatsApp%20Image%202026-05-05%20at%2011.26.06%20AM.jpeg)


# III. DESCRIPCIÓN DE COMPONENTES

Los cuatro workers son proyectos independientes ubicados en directorios separados
(camera_worker/, inference/, recording_worker/, conversion_worker/). Cada uno mantiene
su propio entorno virtual y dependencias, lo que evita conflictos de dependencias entre
las versiones de Python que cada worker requiere. Esta sección describe cada componente
con sus detalles de implementación y los resultados medidos.

## camera-worker

Servicio que captura video desde V4L2 con OpenCV. Mantiene una sola apertura del
dispositivo y reparte cada frame a los clientes conectados con colas independientes.

Esto permite que cada consumidor procese la imagen a su ritmo sin afectar al resto. Hoy
hay dos consumidores:

- backend
- recording-worker

Si alguno se atrasa, el camera-worker descarta el frame más antiguo de su cola y
conserva el más reciente. Así, grabación y streaming sostienen 1080p a 30 FPS en
simultáneo.

La configuración por defecto es ZED 2i en modo estéreo SBS (3840x1080, YUYV) a 30 FPS.
El camera-worker recorta al ojo izquierdo y entrega un frame BGR de 1920x1080.

El frontend permite cambiar entre 720p y 1080p en línea desde el módulo Vision. La
resolución activa se persiste en data/robot/camera_settings.json. Si el archivo falta o
es inválido, hace fallback a 1080p.

## inference-worker

Servicio que ejecuta detección y tracking sobre cada frame. Recibe imágenes JPEG del
backend por /tmp/inference.sock, corre YOLO v11 con tracking BotSort en GPU y devuelve
las detecciones con su track_id.

Acepta dos formatos de modelo:

- .pt (PyTorch CUDA)
- .engine (TensorRT FP16)

El backend puede enviar el comando reload_model para alternar el modelo activo sin
reiniciar el proceso. Esto aplica tras una sincronización con el servidor o tras una
conversión TensorRT recién terminada.

Usar TensorRT FP16 reduce la latencia por frame y eleva el FPS efectivo, aprovechando
los Tensor Cores de la Jetson que el .pt deja sin uso. La Tabla 3 resume el rendimiento
medido.

<!-- widths: 3120,2080,2080,2080 -->
| Backend de inferencia | Latencia p50 | Latencia p99 | FPS efectivo |
| --- | --- | --- | --- |
| PyTorch FP32 (.pt) sobre CUDA | ~75 ms | ~85 ms | ~13 |
| TensorRT FP16 (.engine) | 50,9 ms | 57,0 ms | 19,5 |
^TABLA 3. Rendimiento de inferencia YOLO sobre Jetson Xavier (medido sobre 600 frames a 640x640).

## recording-worker

Servicio que codifica el stream de la cámara a H.264 y emite un MP4 fragmentado por
sesión. Permanece en reposo hasta recibir el comando start: en idle no consume CPU,
NVENC ni mantiene conexión con la cámara.

Al iniciar, se conecta al camera-worker, elige el codificador disponible y graba hasta
recibir el comando stop. El bitrate se autoescala según la altura del frame. La Tabla 4
muestra los codificadores posibles según la plataforma.


| Plataforma | Codificador | Bitrate (1080p / 720p) |
| --- | --- | --- |
| Jetson Xavier (GStreamer) | nvv4l2h264enc | 12 / 8 Mbps |
| Desktop NVIDIA (PyAV) | h264_nvenc | 12 / 8 Mbps |
| Sin GPU (PyAV fallback) | libx264 | 9 / 6 Mbps |
^TABLA 4. Backends de codificación seleccionados por el recording-worker.

Sobre Jetson, el plugin nvv4l2h264enc se entrega con el paquete nvidia-l4t-gstreamer de
JetPack. El script de despliegue verifica con gst-inspect-1.0 que el plugin esté
disponible antes de habilitar la unidad systemd.

## conversion-worker

Servicio que construye engines TensorRT FP16 a partir de modelos .pt usando el método
export() de Ultralytics. Atiende solicitudes por /tmp/conversion.sock y procesa una
conversión a la vez; si llega una segunda mientras hay otra en curso, el worker
responde 409.

Cada engine se cachea con el sha256 del .pt incrustado en el nombre del archivo. Esto
invalida la cache automáticamente cuando el modelo se reentrena.

En la Jetson, el venv del worker se crea con uv venv --system-site-packages para
heredar los bindings de tensorrt que provee JetPack vía el paquete python3-libnvinfer.

# IV. BACKEND

El backend es una aplicación **FastAPI** que actúa como coordinador central, es el único
proceso que se comunica con el frontend (mediante HTTP), los workers le hablan por
sockets Unix.

El backend cumple tres roles que se entrelazan:

- **Orquestar los workers.** Decide qué modelo cargar, qué resolución usar, cuándo
  grabar. Los workers no se comunican entre sí; el backend traduce las acciones del
  operador en comandos hacia el worker correspondiente.

- **Exponer la API al frontend.** Sirve los endpoints REST y la conexión WebRTC que la
  interfaz consume.

- **Persistir y sincronizar.** Guarda sesiones, eventos y configuración en la base de
  datos local y ejecuta el loop de sincronización con el servidor central cuando hay
  conectividad.

## Orquestación de los workers

El backend dirige a cada worker mediante un comando específico sobre su socket Unix. La
Tabla 5 resume los comandos típicos.


| Worker | Comandos típicos |
| --- | --- |
| camera-worker | reload (cambia la resolución 720p o 1080p) |
| inference-worker | reload_model (carga un nuevo .pt o .engine) |
| recording-worker | start, stop (controlan la grabación de la sesión) |
| conversion-worker | convert (encola un build TensorRT) |
^TABLA 5. Comandos que el backend dirige a cada worker.

## Ciclo de una sesión de conteo

Una sesión de conteo es la unidad de trabajo principal del sistema, a continuación se
muestra una lista con los pasos a alto nivel que usa el backend para coordinar el resto
de componentes:

1. El operador inicia la sesión desde el frontend, indicando camellón, clase objetivo
   y modelo.

2. El backend ordena al recording-worker que empiece a grabar el stream.

3. Por cada frame que llega del camera-worker, el backend lo envía al inference-worker y
   reenvía las detecciones al frontend por el data channel de WebRTC.

4. Cuando un objeto cruza la línea configurada, el backend registra el evento en SQLite
   asociado a la sesión.

5. Al finalizar, el backend ordena al recording-worker el cierre y enlaza el archivo MP4
   resultante con la sesión.

Los datos quedan asociados a un camellón, un robot y un modelo YOLO, y pueden
consultarse por fecha o exportarse en CSV.

## Configuración

El backend expone al frontend la configuración del robot:

- **cámara:** dispositivo, resolución, recorte estéreo.
- **conteo:** modo vertical u horizontal, posición de la línea, dirección.
- **modelos asignados** y activación de TensorRT por modelo (card "Modelos asignados"
  en /settings, visible solo en modo robot).
- **setup inicial:** URL del servidor central y API key del dispositivo, una sola vez
  en el primer arranque.

## Sincronización y autenticación

En modo robot, un loop en segundo plano se activa cuando detecta conectividad y se
ejecuta cada 30 segundos. El flujo tiene dos fases:

- **Push.** Envía al servidor los registros locales no sincronizados (empresas, fundos,
  locations, camellones, sesiones, eventos) en orden de dependencia. Cada lote viaja
  por POST autenticado con API key del dispositivo; el servidor deduplica por UUID.

- **Pull.** Consulta los modelos asignados al robot y descarga los faltantes o los que
  tienen un hash distinto. Tras descargar un modelo, el backend envía reload_model al
  inference-worker para cargarlo sin reiniciar; si el operador tiene TensorRT activado,
  el conversion-worker construye el engine FP16 a partir del .pt recién descargado.

En modo servidor, los endpoints están protegidos con autenticación JWT (rol admin o
viewer, asociado a una empresa) y los de sincronización usan API key del dispositivo.
El modo robot no requiere autenticación, ya que opera en una red local aislada.

# V. FRONTEND

El frontend es una aplicación React 19 con TypeScript que se compila a archivos
estáticos servidos por nginx. La interfaz se adapta automáticamente según el modo de
operación y el rol del usuario.

En modo robot, la interfaz principal es el módulo de visión. El operador visualiza el
video en tiempo real con las detecciones superpuestas, configura la línea de conteo,
selecciona el camellón y la clase objetivo, alterna la resolución entre 1080p y 720p, e
inicia sesiones de conteo. La página /settings expone la card 'Modelos asignados', donde
se activa TensorRT por modelo. Al activar el toggle, el frontend hace polling cada 5
segundos para reflejar el estado de la conversión hasta que el engine quede listo.

En modo servidor, la interfaz incluye un sistema de login con JWT y páginas de
administración para usuarios, empresas, fundos, modelos y dispositivos. Los usuarios
viewer ven solo datos de su empresa. Ambos modos comparten el módulo de mapa (Google
Maps con la ubicación de fundos y conteos acumulados) y el módulo de dashboard
(indicadores y tendencias por fecha y camellón).

# VI. CONTEO POR CRUCE DE LÍNEA

El sistema combina detección por YOLO con tracking de objetos (BotSort) y un algoritmo
de cruce de línea para contar frutos que atraviesan una línea virtual configurada por el
operador.

De forma general el algoritmo ejecuta los siguientes pasos:

1. YOLO detecta objetos en cada frame y BotSort asigna un track_id único a cada objeto
   rastreado.

2. El ObjectCounter mantiene dos listas internas (LIST_0 y LIST_1) que registran la
   posición de cada objeto respecto a la línea.

3. Cuando un objeto cruza de LIST_0 a LIST_1 en la dirección configurada, se registra un
   evento de conteo.

4. El track_id previene conteos duplicados; un mismo objeto solo se cuenta una vez
   aunque permanezca visible durante varios frames.

El algoritmo soporta los siguientes metodos de conteo:

<!-- widths: 2340,2340,4680 -->
| Modo | Dirección | Condición de conteo |
| --- | --- | --- |
| Vertical | top2down | Objeto cruza de arriba hacia abajo (cy > threshold) |
| Vertical | down2top | Objeto cruza de abajo hacia arriba (cy < threshold) |
| Horizontal | left2right | Objeto cruza de izquierda a derecha (cx > threshold) |
| Horizontal | right2left | Objeto cruza de derecha a izquierda (cx < threshold) |
^TABLA 6. Modos de conteo por cruce de línea.

# VII. DESPLIEGUE Y OPERACIÓN

La instalación se ejecuta con `deploy/install.sh <modo>` (robot o server). El script
deja todos los servicios registrados en systemd; arrancan automáticamente al encender
el equipo y se reinician ante fallos.

La administración del robot en producción se hace con los comandos de la Tabla 7.

<!-- widths: 3200,6160 -->
| Comando | Descripción |
| --- | --- |
| make status | Estado de los servicios |
| make restart | Reinicia los servicios |
| make logs | Logs del backend |
| make logs-camera | Logs del camera-worker |
| make logs-inference | Logs del inference-worker |
| make logs-recording | Logs del recording-worker |
| make logs-conversion | Logs del conversion-worker |
| make update | Actualiza código y reinicia los servicios |
^TABLA 7. Comandos de operación del robot.

# VIII. INCIDENCIAS CONOCIDAS

Durante las pruebas de integración del robot móvil se ha identificado la incidencia descrita en la Tabla 8. No es crítica: no bloquea la operación normal del robot ni la inferencia, solo requiere una acción manual del operador para reanudar la conversión TensorRT.

<!-- widths: 600,2600,3000,1700,1100 -->
| # | Incidencia | Descripción | Impacto | Severidad |
| --- | --- | --- | --- | --- |
| 1 | Conversión TensorRT no recupera tras reinicio del backend | Si el backend se reinicia mientras un engine se está construyendo, la fila queda en estado converting hasta que el reconciliador de arranque la marca como error con el mensaje 'Backend reiniciado durante conversión'. El operador debe pulsar Reintentar. | Requiere reintento manual | No crítica |
^TABLA 8. Incidencias detectadas en integración.

# IX. FUNCIONALIDADES PENDIENTES

## Despliegue del servidor central

El servidor del laboratorio aún no ha sido desplegado. El script de instalación y la
configuración de systemd están preparados, pero falta ejecutar la instalación en la PC
del laboratorio, configurar PostgreSQL y establecer el acceso remoto. Hasta que el
servidor esté operativo, la sincronización entre robots y servidor no puede ejecutarse
en producción.

## Mapa offline

El módulo de mapa actualmente depende de conexión a internet para cargar los tiles de
Google Maps. Para operación en campo sin conectividad, se requiere implementar la
descarga previa de tiles y su visualización offline.

## Cámara por red local

Actualmente la cámara se conecta al robot por USB. Por restricciones futuras de
hardware, se requiere soportar la recepción de frames desde una cámara IP a través de la
red WiFi interna del robot, sin depender de conexión a internet.

## Clasificación offline de frutos

Pipeline post-sesión para clasificar frutos individuales detectados durante el conteo.
Incluye extracción de crops por track_id (mejor frame) y clasificación con un modelo
independiente de YOLO orientado a madurez, calidad o variedad.

## Evaluación y finetuning del modelo YOLO

Validación del modelo en sesiones de conteo reales con frutos, documentación de métricas de precisión y reentrenamiento si los resultados no alcanzan la precisión objetivo. La aceleración con TensorRT no altera la métrica de precisión del modelo, por lo que las pruebas se ejecutan indistintamente sobre el .pt o el .engine.

# ANEXO A. STACK TECNOLÓGICO

<!-- widths: 2600,6760 -->
| Componente | Tecnología |
| --- | --- |
| Backend | FastAPI, Uvicorn, Python 3.13, SQLAlchemy async, Alembic |
| Camera worker | Python 3.8, OpenCV (V4L2), numpy, asyncio |
| Inference worker | Python 3.8, Ultralytics YOLO v11, PyTorch CUDA, TensorRT FP16, BotSort |
| Recording worker | Python 3.10, PyAV, GStreamer (nvv4l2h264enc), NVENC |
| Conversion worker | Python 3.8 con --system-site-packages, Ultralytics export, TensorRT (JetPack) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui |
| Streaming de video | WebRTC mediante aiortc, codificación H.264 NVENC |
| Base de datos | SQLite con aiosqlite (robot), PostgreSQL con psycopg async (servidor) |
| Comunicación interna | Sockets Unix, protocolo binario length-prefixed (un socket por worker) |
| Proxy y web server | nginx (proxy inverso y archivos estáticos del frontend) |
| Gestión de servicios | systemd, una unidad por proceso, Restart=on-failure |
| Gestión de dependencias | uv (Python, un venv por worker), npm (Node.js) |
^TABLA 5. Stack tecnológico de la plataforma.

# ANEXO B. MODELO DE DATOS

La base de datos utiliza SQLAlchemy como ORM con soporte asíncrono. Todos los modelos incluyen un campo uuid para sincronización y un campo device_id para identificar el robot de origen. La Tabla 9 resume las entidades del sistema, incluyendo los campos agregados a DetectionModel para soportar TensorRT (tensorrt_enabled, engine_status, engine_error).

<!-- widths: 1800,1800,5760 -->
| Entidad | Grupo | Descripción |
| --- | --- | --- |
| Empresa | Organización | Entidad agroindustrial que agrupa múltiples fundos |
| Fundo | Organización | Unidad productiva asociada a una empresa |
| User | Organización | Usuario con rol (admin o viewer) y empresa asociada |
| Device | Organización | Robot registrado con API key y fecha de última sincronización |
| Location | Operación | Marcador en el mapa con latitud, longitud y polígono opcional |
| Camellon | Operación | Hilera dentro de un fundo donde se ejecuta una sesión de conteo |
| Session | Operación | Sesión de conteo con camellón, robot, clase objetivo, hora de inicio/fin y conteo total |
| Event | Operación | Evento individual de detección por cruce de línea dentro de una sesión |
| Recording | Operación | Archivo MP4 H.264 generado por el recording-worker, asociado a una sesión |
| DetectionModel | Detección | Modelo YOLO con archivo .pt, hash, métricas y campos TensorRT (tensorrt_enabled, engine_status: pytorch/pending/converting/ready/error, engine_error) |
| CaptureBurst | Detección | Ráfaga de frames capturados durante una sesión para auditoría |
| CaptureFrame | Detección | Frame individual con ruta al archivo JPEG y timestamp |
| FrameDetection | Detección | Detección dentro de un frame con bbox, confidence, class_name y track_id |
| SyncLog | Sincronización | Registro que asocia un UUID con marca de tiempo para controlar qué datos ya fueron enviados |
| Command | Sincronización | Cola de comandos del servidor hacia el robot para acciones remotas |
^TABLA 9. Entidades del modelo de datos.
