---
title: DOCUMENTACIÓN TÉCNICA Y EVALUACIÓN DE ALGORITMOS DE IA
subtitle: SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS
version: INFORME TECNICO 4
author: Percy Brayam Cubas Muñoz
date: 5 de mayo de 2026
location: Trujillo - Perú
month: MAYO - 2026
project_quote: ""Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú""
project_code: PE5010-86701-2024-PROCIENCIA
---

<!--
Fuente editable del informe técnico unificado #4 a PROCIENCIA.
Compilar: node docs/informes/generate.js docs/informes/26_05_05_informe_4_unificado.md
-->

# I. INTRODUCCIÓN

El proyecto desarrolla un robot móvil multifuncional para fundos agrícolas de la Región La Libertad. La plataforma de software del robot, denominada Robot Platform, se ejecuta sobre la computadora embebida del robot (NVIDIA Jetson Xavier) y permite al operador detectar, contar y clasificar frutos en tiempo real desde un celular o tablet conectado a la red WiFi del robot.

El equipo trabaja en dos líneas paralelas. La primera línea cubre la plataforma de software: arquitectura, workers, comunicación entre procesos, despliegue y aceleración de inferencia con TensorRT sobre el hardware embebido. La segunda línea cubre la evaluación de modelos de inteligencia artificial para la detección de frutos: entrenamiento y comparación de tres familias de modelos (YoloV9, YoloV10 y YoloV11) sobre un dataset de 800 imágenes de arándanos provenientes del fundo Danper.

Como antecedentes, el informe técnico #2 (enero 2026) reportó la evaluación cuantitativa de los tres modelos sobre el dataset de arándanos, alcanzando un mAP@0.5 máximo de 0.8407 con YoloV9 en su variante Compact a 200 épocas (Cubas, 2026a). El informe técnico #3 (abril 2026) reportó la versión inicial de la plataforma, con un único proceso monolítico para captura, inferencia y grabación. La integración de ese proceso único reveló problemas de aislamiento de fallos, acumulación de frames por desacoplamiento de tasas y conflictos de versiones de Python entre los componentes (Cubas, 2026b).

El presente informe consolida los avances posteriores a esos dos entregables. La plataforma se rediseñó hacia una arquitectura por procesos independientes que se comunican por sockets Unix, se incorporó la aceleración con TensorRT FP16 sobre los Tensor Cores de la Jetson, y se integró el modelo YoloV11 como detector activo. La elección de YoloV11 frente a YoloV9 (que obtuvo el mAP máximo) responde a criterios técnicos que se justifican en el capítulo IV.

La finalidad del informe es documentar el estado actual del sistema, presentar la evaluación cuantitativa de los modelos de detección y fundamentar las decisiones técnicas adoptadas. Las secciones que siguen describen primero la plataforma (capítulo III), luego la evaluación de modelos (capítulo IV), y cierran con las conclusiones y referencias.

# II. OBJETIVO GENERAL

Documentar el estado actual de la plataforma Robot Platform y la evaluación de modelos de detección de objetos sobre el dataset de arándanos, fundamentando las decisiones técnicas que sustentan el sistema desplegado en el robot móvil.

# III. PLATAFORMA

## Visión general

La Robot Platform es el componente de software del robot móvil agrícola. Detecta, cuenta y clasifica frutos en tiempo real mientras el robot recorre los camellones de un fundo. El operador interactúa con el sistema desde un celular o tablet conectado a la red WiFi del robot mediante una interfaz web.

El sistema opera en dos modos diferenciados mediante la variable de entorno ROBOT_MODE.

- **Modo robot:** ejecuta en la computadora embebida del robot (NVIDIA Jetson Xavier). Realiza captura de video, inferencia con YOLO, grabación y clasificación.

- **Modo servidor:** ejecuta en una PC del laboratorio. Recibe datos sincronizados desde múltiples robots y gestiona los modelos YOLO integrados en los robots.

Ambos modos comparten el mismo codebase del backend; la diferencia de comportamiento se controla por la variable de entorno mencionada.

## Arquitectura por procesos

La Figura 1 presenta el diagrama de arquitectura del sistema en modo robot y la Tabla 1 detalla cada proceso. La arquitectura consta de cinco procesos que se comunican por sockets Unix. El cliente accede mediante nginx y recibe video por WebRTC; la sincronización con el servidor central se realiza por HTTP.

::figure /home/pqbas/labinm/robot-platform/docs/diagrams/arquitectura_actual.png
^FIGURA 1. Arquitectura del sistema en modo robot. El backend (azul) coordina cuatro workers independientes: camera-worker (captura), inference-worker (YOLO/TensorRT), recording-worker (NVENC) y conversion-worker (build de engines TensorRT bajo demanda).

<!-- widths: 2200,1400,5760 -->
| Proceso | Socket Unix | Responsabilidad |
| --- | --- | --- |
| Backend | HTTP :8080 | FastAPI + Uvicorn. API REST, WebRTC (aiortc), persistencia SQLite, sincronización HTTP. Coordina los workers. |
| camera-worker | /tmp/camera.sock | Captura V4L2 (ZED 2i estéreo SBS), crop al ojo izquierdo, fan-out a múltiples consumidores (backend WebRTC y recording simultáneos). |
| inference-worker | /tmp/inference.sock | Ultralytics YOLO v11 con tracking BoT-SORT. Carga modelo .pt o engine .engine TensorRT FP16 según selección del operador. Recarga en caliente. |
| recording-worker | /tmp/recording.sock | Codifica el stream de cámara a H.264 con NVENC (Jetson nvv4l2h264enc, desktop h264_nvenc) o libx264 como fallback. Idle = 0 CPU mientras no hay grabación. |
| conversion-worker | /tmp/conversion.sock | Construye engines TensorRT FP16 a partir de modelos .pt cuando el operador activa TensorRT en /settings. Una conversión a la vez. |
^TABLA 1. Procesos del sistema en modo robot.

En modo servidor el sistema ejecuta un único proceso (el backend) sin workers de captura ni inferencia. La Tabla 2 compara las funciones activas en cada modo.

| Robot (Jetson Xavier) | Servidor (PC del laboratorio) |
| --- | --- |
| ROBOT_MODE=robot, puerto 8080 | ROBOT_MODE=server, puerto 9090 |
| SQLite (aiosqlite) | PostgreSQL (psycopg async) |
| Captura de video, inferencia, grabación, conversión TensorRT | Autenticación JWT con roles |
| WebRTC streaming en tiempo real | Administración de modelos, usuarios y dispositivos |
| Sync push (envío de datos) y sync pull (descarga de modelos) | Recepción de sincronización y distribución de modelos |
| Sin autenticación (red local aislada) | Login con usuario y contraseña |
^TABLA 2. Funciones activas por modo de operación.

La descomposición en backend más cuatro workers responde a un conjunto de problemas concretos identificados durante la integración del sistema monolítico anterior.

- **Aislamiento de fallos,** debido a que un fallo del modelo o de la cámara dejaba el backend irrecuperable. Con procesos separados, systemd reinicia el worker sin afectar streaming ni API.

- **Desacoplamiento de tasas de frame,** debido a que la captura (20-30 FPS) e inferencia (12-19 FPS) operan a ritmos distintos. En un solo proceso los frames se acumulan en el buffer provocando retardos en video; en procesos separados cada uno avanza a su ritmo sin acumulación.

- **Desacoplamiento del acceso a la cámara,** debido a que la API estándar del kernel de Linux (V4L2) no admite múltiples consumidores sobre una cámara. El camera-worker abre el dispositivo una vez y reparte por colas al backend y al recording-worker.

- **Independencia de versiones entre procesos,** debido a que JetPack 5.1 solo entrega PyTorch CUDA y TensorRT para Python 3.8, mientras el backend exige Python 3.13. Cada worker mantiene su propio entorno virtual.

- **Costo cero en reposo,** debido a que recording-worker y conversion-worker no abren cámara ni cargan modelos hasta recibir un comando, liberando NVENC, GPU y memoria entre sesiones.

- **Recarga de modelo en caliente,** debido a que el inference-worker acepta el comando reload_model y carga un nuevo .pt o .engine sin reiniciar, tras sincronización o conversión TensorRT.

- **Monitoreo independiente,** debido a que cada proceso es una unidad systemd con su propio journal, lo que permite depurarlo sin interrumpir otro componente.

![FIGURA 2. Módulo de visión operando sobre el robot móvil. La detección (bounding box verde) y la línea de conteo se renderizan sobre el video transmitido por WebRTC. El stream sostiene 1080p a 30 FPS y la inferencia con PyTorch alcanza 12 FPS sobre la Jetson Xavier.](/home/pqbas/Downloads/WhatsApp%20Image%202026-05-05%20at%2011.26.06%20AM.jpeg)

## Workers

Los cuatro workers son proyectos independientes ubicados en directorios separados (camera_worker/, inference/, recording_worker/, conversion_worker/). Cada uno mantiene su propio entorno virtual y dependencias, lo que evita conflictos entre las versiones de Python que cada worker requiere.

### camera-worker

Captura video desde V4L2 con OpenCV. Mantiene una sola apertura del dispositivo y reparte cada frame a los clientes conectados con colas independientes. Esto permite que cada consumidor procese la imagen a su ritmo sin afectar al resto. Actualmente hay dos consumidores: backend y recording-worker.

Si alguno se atrasa, el camera-worker descarta el frame más antiguo de su cola y conserva el más reciente. Así, grabación y streaming sostienen 1080p a 30 FPS en simultáneo.

La configuración por defecto es ZED 2i en modo estéreo SBS (3840x1080, YUYV) a 30 FPS. El camera-worker recorta al ojo izquierdo y entrega un frame BGR de 1920x1080. El frontend permite cambiar entre 720p y 1080p en línea desde el módulo Vision; la resolución activa se persiste en data/robot/camera_settings.json.

### inference-worker

Ejecuta detección y tracking sobre cada frame. Recibe imágenes JPEG del backend por /tmp/inference.sock, corre YOLO v11 con tracking BoT-SORT en GPU y devuelve las detecciones con su track_id. Acepta dos formatos de modelo: .pt (PyTorch CUDA) y .engine (TensorRT FP16).

El backend puede enviar el comando reload_model para alternar el modelo activo sin reiniciar el proceso. Esto aplica tras una sincronización con el servidor o tras una conversión TensorRT recién terminada.

### recording-worker

Codifica el stream de la cámara a H.264 y emite un MP4 fragmentado por sesión. Permanece en reposo hasta recibir el comando start: en idle no consume CPU, NVENC ni mantiene conexión con la cámara. Al iniciar, se conecta al camera-worker, elige el codificador disponible y graba hasta recibir el comando stop. El bitrate se autoescala según la altura del frame. La Tabla 3 muestra los codificadores posibles según la plataforma.

| Plataforma | Codificador | Bitrate (1080p / 720p) |
| --- | --- | --- |
| Jetson Xavier (GStreamer) | nvv4l2h264enc | 12 / 8 Mbps |
| Desktop NVIDIA (PyAV) | h264_nvenc | 12 / 8 Mbps |
| Sin GPU (PyAV fallback) | libx264 | 9 / 6 Mbps |
^TABLA 3. Backends de codificación seleccionados por el recording-worker.

Sobre Jetson, el plugin nvv4l2h264enc se entrega con el paquete nvidia-l4t-gstreamer de JetPack. El script de despliegue verifica con gst-inspect-1.0 que el plugin esté disponible antes de habilitar la unidad systemd.

### conversion-worker

Construye engines TensorRT FP16 a partir de modelos .pt usando el método export() de Ultralytics. Atiende solicitudes por /tmp/conversion.sock y procesa una conversión a la vez; si llega una segunda mientras hay otra en curso, el worker responde 409.

Cada engine se cachea con el sha256 del .pt incrustado en el nombre del archivo. Esto invalida la cache automáticamente cuando el modelo se reentrena. En la Jetson, el venv del worker se crea con `uv venv --system-site-packages` para heredar los bindings de tensorrt que provee JetPack vía el paquete python3-libnvinfer.

## Aceleración con TensorRT FP16

La Jetson Xavier integra Tensor Cores que aceleran operaciones de matriz en FP16 sobre los SM (streaming multiprocessors). El modelo .pt ejecutado en PyTorch FP32 no aprovecha estos recursos. La conversión a un engine TensorRT FP16 reduce la latencia por frame y eleva el FPS efectivo. La Tabla 4 resume el rendimiento medido sobre 600 frames a 640x640 con clocks pinned (`sudo jetson_clocks`).

<!-- widths: 3120,2080,2080,2080 -->
| Backend de inferencia | Latencia p50 | Latencia p99 | FPS efectivo |
| --- | --- | --- | --- |
| PyTorch FP32 (.pt) sobre CUDA | ~75 ms | ~85 ms | ~13 |
| TensorRT FP16 (.engine) | 50,9 ms | 57,0 ms | 19,5 |
^TABLA 4. Rendimiento de inferencia YOLO sobre Jetson Xavier (medido sobre 600 frames a 640x640).

El operador activa o desactiva TensorRT por modelo desde la card "Modelos asignados" en /settings (visible solo en modo robot). Al activar el toggle, el conversion-worker construye el engine FP16 a partir del .pt, y al terminar el inference-worker recarga el modelo en caliente sin interrumpir el streaming.

## Backend

El backend es una aplicación FastAPI que actúa como coordinador central. Es el único proceso que se comunica con el frontend (mediante HTTP); los workers le hablan por sockets Unix.

El backend cumple tres roles que se entrelazan:

- **Orquestar los workers.** Decide qué modelo cargar, qué resolución usar y cuándo grabar. Los workers no se comunican entre sí; el backend traduce las acciones del operador en comandos hacia el worker correspondiente.

- **Exponer la API al frontend.** Sirve los endpoints REST y la conexión WebRTC que la interfaz consume.

- **Persistir y sincronizar.** Guarda sesiones, eventos y configuración en la base de datos local y ejecuta el loop de sincronización con el servidor central cuando hay conectividad.

La Tabla 5 resume los comandos que el backend dirige a cada worker.

| Worker | Comandos típicos |
| --- | --- |
| camera-worker | reload (cambia la resolución 720p o 1080p) |
| inference-worker | reload_model (carga un nuevo .pt o .engine) |
| recording-worker | start, stop (controlan la grabación de la sesión) |
| conversion-worker | convert (encola un build TensorRT) |
^TABLA 5. Comandos que el backend dirige a cada worker.

Una sesión de conteo es la unidad de trabajo principal del sistema y sigue los siguientes pasos:

1. El operador inicia la sesión desde el frontend, indicando camellón, clase objetivo y modelo.
2. El backend ordena al recording-worker que empiece a grabar el stream.
3. Por cada frame que llega del camera-worker, el backend lo envía al inference-worker y reenvía las detecciones al frontend por el data channel de WebRTC.
4. Cuando un objeto cruza la línea configurada, el backend registra el evento en SQLite asociado a la sesión.
5. Al finalizar, el backend ordena al recording-worker el cierre y enlaza el archivo MP4 resultante con la sesión.

En modo robot, un loop de sincronización en segundo plano se activa cuando detecta conectividad y se ejecuta cada 30 segundos. Tiene dos fases: push (envía registros locales no sincronizados al servidor) y pull (descarga modelos asignados al robot). En modo servidor, los endpoints están protegidos con autenticación JWT (rol admin o viewer, asociado a una empresa) y los de sincronización usan API key del dispositivo.

## Frontend

El frontend es una aplicación React 19 con TypeScript que se compila a archivos estáticos servidos por nginx. La interfaz se adapta automáticamente según el modo de operación y el rol del usuario.

En modo robot, la interfaz principal es el módulo de visión, donde el operador visualiza el video en tiempo real con las detecciones superpuestas, configura la línea de conteo, selecciona el camellón y la clase objetivo, alterna la resolución entre 1080p y 720p, e inicia sesiones de conteo. La página /settings expone la card "Modelos asignados", donde se activa TensorRT por modelo. Al activar el toggle, el frontend hace polling cada 5 segundos para reflejar el estado de la conversión hasta que el engine quede listo.

En modo servidor, la interfaz incluye un sistema de login con JWT y páginas de administración para usuarios, empresas, fundos, modelos y dispositivos. Los usuarios viewer ven solo datos de su empresa. Ambos modos comparten el módulo de mapa (Google Maps con la ubicación de fundos y conteos acumulados) y el módulo de dashboard (indicadores y tendencias por fecha y camellón).

## Conteo por cruce de línea

El sistema combina detección por YOLO con tracking de objetos (BoT-SORT) y un algoritmo de cruce de línea para contar frutos que atraviesan una línea virtual configurada por el operador. El algoritmo ejecuta los siguientes pasos:

1. YOLO detecta objetos en cada frame y BoT-SORT asigna un track_id único a cada objeto rastreado.
2. El ObjectCounter mantiene dos listas internas (LIST_0 y LIST_1) que registran la posición de cada objeto respecto a la línea.
3. Cuando un objeto cruza de LIST_0 a LIST_1 en la dirección configurada, se registra un evento de conteo.
4. El track_id previene conteos duplicados; un mismo objeto solo se cuenta una vez aunque permanezca visible durante varios frames.

La Tabla 6 resume los modos de conteo soportados.

<!-- widths: 2340,2340,4680 -->
| Modo | Dirección | Condición de conteo |
| --- | --- | --- |
| Vertical | top2down | Objeto cruza de arriba hacia abajo (cy > threshold) |
| Vertical | down2top | Objeto cruza de abajo hacia arriba (cy < threshold) |
| Horizontal | left2right | Objeto cruza de izquierda a derecha (cx > threshold) |
| Horizontal | right2left | Objeto cruza de derecha a izquierda (cx < threshold) |
^TABLA 6. Modos de conteo por cruce de línea.

## Despliegue

La instalación se ejecuta con `deploy/install.sh <modo>` (robot o server). El script deja todos los servicios registrados en systemd; arrancan automáticamente al encender el equipo y se reinician ante fallos. La administración del robot en producción se hace con los comandos de la Tabla 7.

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

## Incidencias resueltas y pendientes

Durante la integración se identificó una incidencia operativa, descrita en la Tabla 8. No bloquea la operación normal del robot ni la inferencia y solo requiere una acción manual del operador para reanudar la conversión TensorRT.

<!-- widths: 600,2600,3000,1700,1100 -->
| # | Incidencia | Descripción | Impacto | Severidad |
| --- | --- | --- | --- | --- |
| 1 | Conversión TensorRT no recupera tras reinicio del backend | Si el backend se reinicia mientras un engine se está construyendo, la fila queda en estado converting hasta que el reconciliador de arranque la marca como error con el mensaje "Backend reiniciado durante conversión". El operador debe pulsar Reintentar. | Requiere reintento manual | No crítica |
^TABLA 8. Incidencias detectadas en integración.

Quedan pendientes el despliegue del servidor central en la PC del laboratorio, la implementación de mapa offline para operación sin conectividad, el soporte de cámara IP por red local, y el pipeline de clasificación offline de frutos por madurez y calidad.

# IV. EVALUACIÓN DE MODELOS DE IA

Esta sección resume la evaluación cuantitativa de tres familias de modelos de detección de objetos sobre el dataset de arándanos del fundo Danper. La evaluación detallada de arquitecturas, curvas de entrenamiento y análisis de errores se presenta en el informe técnico #2 (Cubas, 2026a). Aquí se reportan los algoritmos evaluados, las métricas empleadas, los resultados por modelo y la justificación del modelo seleccionado para producción.

## 4.1 Algoritmos evaluados

Se entrenaron y evaluaron tres familias de modelos YOLO. La Tabla 9 sintetiza el origen y la contribución técnica de cada uno.

| Modelo | Origen | Contribución técnica |
| --- | --- | --- |
| YoloV9 | Wang et al. (2024), Academia Sinica | Introduce Programmable Gradient Information y la arquitectura RepNCSPELAN para preservar información gradiente en redes profundas. |
| YoloV10 | Wang et al. (2024), Tsinghua University | Elimina la operación NMS mediante un esquema de asignación dual one-to-many y one-to-one durante el entrenamiento. |
| YoloV11 | Ultralytics (2024) | Introduce el bloque C3k2 en el backbone y el bloque C2PSA con atención posicional, manteniendo compatibilidad con el ecosistema Ultralytics. |
^TABLA 9. Algoritmos de detección evaluados.

El dataset de entrenamiento consta de 800 imágenes no públicas de arándanos del fundo Danper, etiquetadas manualmente con bounding boxes. Cada modelo se entrenó variando dos hiperparámetros: backbone (Tiny/Small/Medium/Large/Compact según corresponda al modelo) y número de épocas (50, 100, 150, 200), produciendo entre 16 y 20 configuraciones por familia.

## 4.2 Métricas de evaluación

Las métricas reportadas para cada configuración se definen en la Tabla 10.

| Métrica | Definición |
| --- | --- |
| mAP@0.5 | Precisión promedio sobre todas las clases con IoU mínimo de 0.5 entre detección y ground truth. |
| mAP@0.5:0.95 | Precisión promedio en el rango de IoU de 0.5 a 0.95 con paso 0.05, métrica primaria del benchmark COCO. |
| F1-score@0.5 | Media armónica entre precisión y recall a IoU 0.5. |
| Precisión@0.5 | Proporción de detecciones correctas sobre el total de detecciones a IoU 0.5. |
| Recall@0.5 | Proporción de objetos reales detectados a IoU 0.5. |
| mError@0.5 y mError@0.3 | Tasa media de error a los IoU indicados. |
^TABLA 10. Métricas de evaluación reportadas en el informe técnico #2.

## 4.3 Resultados por modelo

Las Tablas 11, 12 y 13 reportan los resultados de entrenamiento de YoloV9, YoloV10 y YoloV11 respectivamente. Los valores se transcriben del informe técnico #2.

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tiny | 50 | 2.006 | 0.8133 | 0.4621 | 0.7551 | 0.7668 | 0.7437 | 0.5413 | 0.3306 |
| Tiny | 100 | 2.006 | 0.8225 | 0.4702 | 0.7598 | 0.7727 | 0.7474 | 0.5819 | 0.3833 |
| Tiny | 150 | 2.006 | 0.8264 | 0.4806 | 0.7646 | 0.7724 | 0.7558 | 0.5663 | 0.4026 |
| Tiny | 200 | 2.006 | 0.824 | 0.4788 | 0.7639 | 0.7685 | 0.7592 | 0.5725 | 0.3979 |
| Small | 50 | 7.288 | 0.8311 | 0.4809 | 0.7665 | 0.7745 | 0.7586 | 0.45 | 0.3438 |
| Small | 100 | 7.288 | 0.8346 | 0.4918 | 0.7714 | 0.7745 | 0.7682 | 0.5196 | 0.4006 |
| Small | 150 | 7.288 | 0.8341 | 0.4915 | 0.7706 | 0.7741 | 0.7752 | 0.4409 | 0.2993 |
| Small | 200 | 7.288 | 0.8328 | 0.495 | 0.7697 | 0.7772 | 0.7623 | 0.4006 | 0.2904 |
| Medium | 50 | 20.159 | 0.8348 | 0.4927 | 0.7702 | 0.7677 | 0.7728 | 0.4271 | 0.2546 |
| Medium | 100 | 20.159 | 0.8348 | 0.4927 | 0.7702 | 0.7677 | 0.7728 | 0.4271 | 0.2546 |
| Medium | 150 | 20.159 | 0.8394 | 0.4949 | 0.7741 | 0.7642 | 0.7842 | 0.4804 | 0.3461 |
| Medium | 200 | 20.159 | 0.8373 | 0.4945 | 0.7681 | 0.7559 | 0.7808 | 0.5566 | 0.3853 |
| Compact | 50 | 25.53 | 0.833 | 0.4902 | 0.7697 | 0.7685 | 0.7709 | 0.44 | 0.2804 |
| Compact | 100 | 25.53 | 0.8299 | 0.4886 | 0.7685 | 0.7721 | 0.765 | 0.4653 | 0.3238 |
| Compact | 150 | 25.53 | 0.8327 | 0.4926 | 0.77 | 0.7775 | 0.7626 | 0.4186 | 0.3118 |
| Compact | 200 | 25.53 | 0.8407 | 0.4939 | 0.7703 | 0.7679 | 0.7727 | 0.5723 | 0.4350 |
^TABLA 11. Resultados del entrenamiento del modelo YoloV9 con 800 imágenes de arándanos del fundo Danper.

YoloV9 alcanza el mAP@0.5 más alto del estudio con la variante Compact a 200 épocas (0.8407). En las variantes Tiny, Small y Medium se observa una tendencia al sobreajuste a partir de 100 épocas, donde el mAP@0.5:0.95 se estabiliza o decrece pese al incremento de épocas.

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nano | 50 | 2.707 | 0.7894 | 0.4468 | 0.7364 | 0.7459 | 0.7272 | 0.6044 | 0.4471 |
| Nano | 100 | 2.707 | 0.8066 | 0.4651 | 0.7471 | 0.7514 | 0.7428 | 0.4904 | 0.3832 |
| Nano | 150 | 2.707 | 0.816 | 0.4721 | 0.7529 | 0.7664 | 0.74 | 0.4997 | 0.3991 |
| Nano | 200 | 2.707 | 0.8136 | 0.4706 | 0.7504 | 0.741 | 0.76 | 0.4977 | 0.3427 |
| Small | 50 | 8.067 | 0.8238 | 0.4762 | 0.759 | 0.7568 | 0.7612 | 0.5546 | 0.3877 |
| Small | 100 | 8.067 | 0.8261 | 0.482 | 0.7606 | 0.7647 | 0.7566 | 0.5068 | 0.3651 |
| Small | 150 | 8.067 | 0.8245 | 0.4845 | 0.7591 | 0.7567 | 0.7614 | 0.4811 | 0.3583 |
| Small | 200 | 8.067 | 0.8188 | 0.4804 | 0.7595 | 0.7604 | 0.7587 | 0.4818 | 0.3583 |
| Medium | 50 | 16.485 | 0.828 | 0.4817 | 0.7616 | 0.755 | 0.7683 | 0.466 | 0.3391 |
| Medium | 100 | 16.485 | 0.8309 | 0.4905 | 0.765 | 0.7717 | 0.7584 | 0.4717 | 0.3465 |
| Medium | 150 | 16.485 | 0.8305 | 0.4918 | 0.7628 | 0.7685 | 0.7571 | 0.3769 | 0.2674 |
| Medium | 200 | 16.485 | 0.8275 | 0.4905 | 0.7619 | 0.7572 | 0.7667 | 0.3867 | 0.3044 |
| Large | 50 | 25.767 | 0.8292 | 0.486 | 0.764 | 0.7588 | 0.7694 | 0.444 | 0.3088 |
| Large | 100 | 25.767 | 0.8231 | 0.489 | 0.7591 | 0.7614 | 0.7569 | 0.5225 | 0.419 |
| Large | 150 | 25.767 | 0.8116 | 0.4791 | 0.753 | 0.7424 | 0.7638 | 0.3991 | 0.2923 |
| Large | 200 | 25.767 | 0.8097 | 0.486 | 0.7591 | 0.7543 | 0.7607 | 0.4472 | 0.3743 |
^TABLA 12. Resultados del entrenamiento del modelo YoloV10 con 800 imágenes de arándanos del fundo Danper.

YoloV10 sigue un patrón similar a YoloV9 en backbones grandes: las variantes Medium y Large muestran caída de mAP@0.5 entre 100 y 200 épocas, indicador de sobreajuste con el tamaño del dataset. El máximo se obtiene con Medium a 100 épocas (0.8309).

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nano | 50 | 2.59 | 0.8091 | 0.4573 | 0.7504 | 0.7601 | 0.741 | 0.5755 | 0.3738 |
| Nano | 100 | 2.59 | 0.8153 | 0.4663 | 0.7548 | 0.7692 | 0.7409 | 0.4841 | 0.3279 |
| Nano | 150 | 2.59 | 0.821 | 0.4734 | 0.7599 | 0.7639 | 0.756 | 0.5067 | 0.3487 |
| Nano | 200 | 2.59 | 0.8228 | 0.4728 | 0.7623 | 0.7672 | 0.7574 | 0.4529 | 0.3151 |
| Small | 50 | 9.428 | 0.8311 | 0.4802 | 0.7695 | 0.7725 | 0.7666 | 0.4911 | 0.3183 |
| Small | 100 | 9.428 | 0.8295 | 0.4859 | 0.7663 | 0.7677 | 0.7648 | 0.4304 | 0.3239 |
| Small | 150 | 9.428 | 0.8338 | 0.4925 | 0.7675 | 0.7684 | 0.7666 | 0.4982 | 0.3685 |
| Small | 200 | 9.428 | 0.8293 | 0.4914 | 0.7627 | 0.756 | 0.758 | 0.4562 | 0.3402 |
| Medium | 50 | 20.054 | 0.8265 | 0.4862 | 0.7638 | 0.7558 | 0.7719 | 0.4281 | 0.3054 |
| Medium | 100 | 20.054 | 0.833 | 0.4946 | 0.7677 | 0.7672 | 0.7682 | 0.4434 | 0.3055 |
| Medium | 150 | 20.054 | 0.831 | 0.4929 | 0.7629 | 0.7765 | 0.7499 | 0.3966 | 0.2901 |
| Medium | 200 | 20.054 | 0.8262 | 0.493 | 0.7664 | 0.7685 | 0.7642 | 0.4166 | 0.3087 |
| Large | 50 | 25.311 | 0.8293 | 0.4884 | 0.7625 | 0.7706 | 0.7544 | 0.4437 | 0.296 |
| Large | 100 | 25.311 | 0.8335 | 0.4951 | 0.7693 | 0.7748 | 0.7639 | 0.4114 | 0.3035 |
| Large | 150 | 25.311 | 0.8274 | 0.4921 | 0.7625 | 0.7552 | 0.7699 | 0.4219 | 0.3027 |
| Large | 200 | 25.311 | 0.8278 | 0.4929 | 0.7657 | 0.7607 | 0.7708 | 0.4412 | 0.347 |
^TABLA 13. Resultados del entrenamiento del modelo YoloV11 con 800 imágenes de arándanos del fundo Danper.

YoloV11 no muestra el comportamiento decreciente observado en YoloV9 y YoloV10 al aumentar las épocas. En cambio, los valores de mAP@0.5 oscilan ligeramente alrededor de un nivel estable, lo que indica una convergencia más predecible. El máximo se obtiene con Small a 150 épocas (0.8338) y Large a 100 épocas (0.8335), con variantes Medium muy próximas.

## 4.4 Modelo seleccionado

La Tabla 14 reporta el mAP@0.5 máximo de cada familia y la configuración correspondiente.

| Modelo | Backbone | Épocas | mAP@0.5 | mAP@0.5:0.95 |
| --- | --- | --- | --- | --- |
| YoloV9 | Compact | 200 | 0.8407 | 0.4939 |
| YoloV10 | Medium | 100 | 0.8309 | 0.4905 |
| YoloV11 | Small | 150 | 0.8338 | 0.4925 |
^TABLA 14. Mejor configuración por familia de modelos sobre el dataset Danper.

YoloV9-Compact-200 obtiene el mAP@0.5 más alto del estudio. La diferencia con YoloV11-Small-150 es de 0.0069 puntos, dentro del rango de variabilidad observado entre épocas adyacentes en cualquiera de los tres modelos. El sistema desplegado utiliza YoloV11 por las siguientes razones técnicas que la métrica aislada no captura.

- **Estabilidad de entrenamiento,** debido a que YoloV11 no exhibe la caída de mAP@0.5 entre 100 y 200 épocas que sí muestran YoloV9 y YoloV10 en sus variantes Medium y Large. Esto reduce el riesgo de degradación al reentrenar con datasets ampliados sin ajustar manualmente el número de épocas.

- **Compatibilidad con BoT-SORT,** debido a que el ecosistema Ultralytics integra el tracker BoT-SORT directamente sobre el flujo de inferencia de YoloV11 (`model.track()`). YoloV9 requiere un wrapper adicional para componer la detección con el tracker, incrementando la latencia y la superficie de error.

- **Exportación a TensorRT FP16,** debido a que el método export() de Ultralytics produce un engine TensorRT consumible directamente por el inference-worker para YoloV11. La conversión de YoloV9 requiere pasos manuales adicionales (ONNX intermedio, ajuste de capas no soportadas) que no están disponibles bajo demanda desde el operador.

- **Mantenimiento del repositorio,** debido a que Ultralytics publica YoloV11 como modelo activo con releases frecuentes y soporte de la comunidad, mientras YoloV9 se mantiene en el repositorio original de los autores con menor cadencia de actualización.

La diferencia de 0.0069 en mAP@0.5 a favor de YoloV9 no compensa el costo operativo de los cuatro factores anteriores. El sistema desplegado sostiene 19,5 FPS efectivos sobre TensorRT FP16 (Tabla 4), consistente con los requisitos de captura del robot móvil.

# V. CONCLUSIONES

1. La arquitectura por procesos independientes resuelve los problemas de aislamiento de fallos, desacoplamiento de tasas de frame y conflictos de versiones de Python que presentaba el sistema monolítico anterior. Captura, inferencia y grabación operan en simultáneo a 1080p y 30 FPS sin acumulación de buffers ni regresión en el módulo de visión.

2. La aceleración con TensorRT FP16 sobre los Tensor Cores de la Jetson Xavier reduce la latencia de inferencia de 75 ms a 50,9 ms en el percentil 50 y eleva el FPS efectivo de 13 a 19,5, manteniendo el modelo intacto sin alterar la métrica de detección.

3. Los tres modelos evaluados alcanzan mAP@0.5 superiores a 0.83 sobre el dataset Danper. YoloV9-Compact-200 obtiene el máximo (0.8407), pero el sistema desplegado adopta YoloV11 por la estabilidad de entrenamiento, la integración nativa con BoT-SORT, la exportación directa a TensorRT y el mantenimiento del repositorio Ultralytics. La diferencia de mAP@0.5 entre ambos (0.0069) está dentro del rango de variabilidad entre configuraciones adyacentes.

4. Los próximos pasos cubren la reducción del overhead del wrapper de Ultralytics en el flujo de inferencia (donde el modelo puro corre a 16 ms y `model.track()` añade ~35 ms de envoltura), el despliegue del servidor central en la PC del laboratorio y el pipeline de clasificación offline de frutos por madurez y calidad.

# VI. REFERENCIAS

Aharon, N., Orfaig, R. y Bobrovsky, B.-Z. (2022). BoT-SORT: Robust Associations Multi-Pedestrian Tracking. arXiv:2206.14651. https://arxiv.org/abs/2206.14651

Cubas, P. (2026a). Informe técnico #2: Evaluación de algoritmos de detección de objetos para conteo de arándanos. Proyecto PE5010-86701-2024-PROCIENCIA, Universidad Privada Antenor Orrego.

Cubas, P. (2026b). Informe técnico #3: Plataforma de software del robot móvil agrícola, versión inicial. Proyecto PE5010-86701-2024-PROCIENCIA, Universidad Privada Antenor Orrego.

Ultralytics. (2024). YOLO11: Documentation and release notes. https://docs.ultralytics.com/models/yolo11/

Wang, A., Chen, H., Liu, L., Chen, K., Lin, Z., Han, J. y Ding, G. (2024). YOLOv10: Real-Time End-to-End Object Detection. arXiv:2405.14458. https://arxiv.org/abs/2405.14458

Wang, C.-Y., Yeh, I.-H. y Liao, H.-Y. M. (2024). YOLOv9: Learning What You Want to Learn Using Programmable Gradient Information. arXiv:2402.13616. https://arxiv.org/abs/2402.13616
