---
template: upao
lang: es-PE
title: DOCUMENTACIÓN TÉCNICA Y EVALUACIÓN DE ALGORITMOS DE IA
subtitle: SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS
version: INFORME TECNICO 4
author: Percy Brayam Cubas Muñoz
date: 5 de mayo de 2026
location: Trujillo - Perú
month: MAYO - 2026
project_quote: ""Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú""
project_code: PE5010-86701-2024-PROCIENCIA
assets_root: .
---

<!--
Fuente editable del informe técnico unificado #4 a PROCIENCIA.
Compilar: node docs/informes/generate.js docs/informes/26_05_05_informe_4_unificado.md
-->

# I. INTRODUCCIÓN

El proyecto PE5010-86701-2024-PROCIENCIA desarrolla un robot móvil multifuncional para fundos agrícolas de la Región La Libertad. La plataforma de software, denominada Robot Platform, se ejecuta sobre la computadora embebida NVIDIA Jetson Xavier y permite al operador detectar, contar y clasificar frutos en tiempo real desde un celular o tablet conectado a la red WiFi del vehículo.

El desarrollo avanza en dos frentes complementarios. El primero cubre la plataforma de software, que incluye arquitectura, workers, comunicación entre procesos, despliegue y aceleración de inferencia con TensorRT sobre el hardware embebido. El segundo cubre la evaluación de modelos de inteligencia artificial para la detección de frutos, con el entrenamiento y comparación de tres familias de modelos (YoloV9, YoloV10 y YoloV11) sobre un dataset propio de 800 imágenes de arándanos recolectadas en los campos del fundo Danper.

El informe técnico previo de enero 2025 reportó la evaluación cuantitativa de los tres modelos sobre el dataset de arándanos y alcanzó un mAP@0,5 máximo de 0,8407 con YoloV9 en su variante Compact a 200 épocas (Cubas, 2025). El informe técnico de abril 2026 reportó la versión inicial de la plataforma, con un único proceso monolítico para captura, inferencia y grabación; esa integración reveló problemas de aislamiento de fallos, acumulación de frames por desacoplamiento de tasas y conflictos de versiones de Python entre los componentes (Cubas, 2026).

El presente informe consolida los avances posteriores a esos dos entregables. La plataforma se rediseñó hacia una arquitectura por procesos independientes que se comunican por sockets Unix, se incorporó la aceleración con TensorRT FP16 sobre los Tensor Cores de la Jetson, y se cargó YoloV11 como modelo de validación integral de la plataforma. La integración del modelo de producción (YoloV9-Compact-200, seleccionado por su mAP@0,5 máximo en la evaluación cuantitativa) se encuentra en curso y se aborda en el capítulo IV.

La finalidad del informe es documentar el estado actual del sistema, presentar la evaluación cuantitativa de los modelos de detección y fundamentar las decisiones técnicas adoptadas. El código fuente de la plataforma está disponible en el repositorio público https://github.com/pqbas/robot-platform.

# II. OBJETIVO GENERAL

Documentar el estado actual de la plataforma Robot Platform y la evaluación de modelos de detección de objetos sobre el dataset de arándanos, fundamentando las decisiones técnicas que sustentan el sistema desplegado en el robot móvil.

# III. PLATAFORMA

## 3.1 Visión general

La Robot Platform es el componente de software del robot móvil agrícola. Detecta, cuenta y clasifica frutos en tiempo real mientras el robot recorre los camellones de un fundo. El operador interactúa con el sistema desde un celular o tablet conectado a la red WiFi del robot mediante una interfaz web.

El sistema opera en dos modos diferenciados mediante la variable de entorno ROBOT_MODE.

- **Modo robot:** se ejecuta en la computadora embebida del robot (NVIDIA Jetson Xavier) y se encarga de la captura de video, la inferencia con YOLO, la grabación y la clasificación de frutos.

- **Modo servidor:** se ejecuta en una PC del laboratorio, recibe los datos sincronizados desde múltiples robots y administra los modelos YOLO desplegados en cada uno.

Ambos modos comparten el mismo codebase del backend; la diferencia de comportamiento se controla por la variable de entorno mencionada.

## 3.2 Arquitectura por procesos

La Figura 1 presenta el diagrama de arquitectura del sistema en modo robot y la Tabla 1 detalla cada proceso. La arquitectura consta de cinco procesos que se comunican por sockets Unix. El cliente accede mediante nginx y recibe video por WebRTC; la sincronización con el servidor central se realiza por HTTP.

::figure docs/diagrams/arquitectura_actual.png
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

- **Aislamiento de fallos:** debido a que un fallo del modelo o de la cámara dejaba el backend irrecuperable, se decidió ejecutar cada componente como un proceso independiente bajo systemd, consiguiendo que un fallo aislado ya no interrumpa el streaming ni la API.

- **Desacoplamiento de tasas de frame:** debido a que la captura opera entre 20 y 30 FPS mientras la inferencia opera entre 9 y 14 FPS y en un mismo proceso los frames se acumulaban en el buffer provocando retardos en video, se decidió separar captura e inferencia en procesos distintos, consiguiendo que cada worker avance a su propio ritmo sin acumulación.

- **Desacoplamiento del acceso a la cámara:** debido a que la API V4L2 del kernel de Linux no admite múltiples consumidores sobre un mismo dispositivo, se decidió centralizar la captura en el camera-worker, consiguiendo que una sola apertura del dispositivo baste para repartir los frames por colas al backend y al recording-worker.

- **Independencia de versiones entre procesos:** debido a que JetPack 5.1 solo entrega PyTorch CUDA y TensorRT para Python 3.10 mientras el backend requiere Python 3.13, se decidió que cada worker mantuviera su propio entorno virtual, consiguiendo que versiones incompatibles convivan sin conflicto.

- **Uso nulo de recursos en reposo:** debido a que mantener cámara y modelos cargados de forma permanente ocupaba NVENC, GPU y memoria entre sesiones, se decidió que recording-worker y conversion-worker no abrieran cámara ni cargaran modelos hasta recibir un comando, consiguiendo que el sistema libere esos recursos cuando no están en uso.

- **Recarga de modelo en caliente:** debido a que cambiar de modelo exigía reiniciar el proceso de inferencia, se decidió implementar en el inference-worker el comando reload_model, consiguiendo que un nuevo .pt o .engine se cargue sin interrumpir el servicio.

- **Monitoreo independiente:** debido a que un solo journal mezclaba los logs de todos los componentes y dificultaba el diagnóstico, se decidió declarar cada proceso como una unidad systemd separada, consiguiendo que cada componente exponga su propio log y pueda depurarse sin afectar al resto.

![FIGURA 2. Módulo de visión operando sobre el robot móvil. La detección y la línea de conteo se renderizan sobre el video transmitido por WebRTC.](assets/2026-05-06-20-56-02.png)

## 3.3 Descripción de los workers

Los cuatro workers son proyectos independientes ubicados en directorios separados (camera_worker/, inference/, recording_worker/, conversion_worker/). Cada uno mantiene su propio entorno virtual y dependencias, lo que evita conflictos entre las versiones de Python que cada worker requiere.

### 3.3.1 camera-worker

La función principal del camera-worker es centralizar la captura de video del dispositivo V4L2 y repartir cada frame a múltiples consumidores sin abrir la cámara más de una vez, lo que permite que el backend (streaming WebRTC) y el recording-worker (grabación en disco) operen en simultáneo sobre la misma fuente.

Para lograrlo, el worker mantiene una cola independiente por consumidor y, si alguno se atrasa, descarta el frame más antiguo de esa cola y conserva el más reciente, por lo que grabación y streaming sostienen 1080p a 30 FPS sin que un consumidor lento bloquee al resto.

La configuración por defecto de la cámara ZED 2i es modo estéreo, obteniendo en total una resolución de 3840x1080 en formato YUYV a 30 FPS, sobre la cual el camera-worker recorta al ojo izquierdo y entrega un frame BGR de 1920x1080.

La resolución de salida se controla desde el módulo Vision del frontend, donde el operador alterna entre 720p y 1080p en línea, y la elección se persiste en data/robot/camera_settings.json para que el worker la aplique al reabrir el dispositivo.

### 3.3.2 inference-worker

La función principal del inference-worker es ejecutar detección y tracking sobre cada frame que llega del backend, recibiendo imágenes JPEG por /tmp/inference.sock y devolviendo las detecciones con su track_id, donde la inferencia corre YOLO v11 con tracking BoT-SORT en GPU y acepta tanto modelos .pt (PyTorch CUDA) como .engine (TensorRT FP16).

El backend puede enviar el comando reload_model para alternar el modelo activo sin reiniciar el proceso, lo que se aplica tras una sincronización con el servidor o tras una conversión TensorRT recién terminada.

Mientras se completa el entrenamiento e integración del modelo de producción descrito en el capítulo IV, el inference-worker carga YoloV11 preentrenado de Ultralytics como modelo de validación de la plataforma, dado que su flujo expone en una sola llamada `model.track()` la detección y el seguimiento BoT-SORT, y el método `export()` produce directamente un engine TensorRT FP16 consumible por el worker. Con este modelo cargado se verifica sobre el robot real la detección de personas en interiores (independiente de la disponibilidad estacional de arándanos en campo), el algoritmo de conteo por cruce de línea sobre objetos seguidos reales, la recarga en caliente de engines TensorRT FP16 sin interrumpir el streaming WebRTC y el ciclo de sincronización de modelos con el servidor (descarga, conversión y `reload_model`).

### 3.3.3 recording-worker

La función principal del recording-worker es codificar el stream de la cámara a H.264 y emitir un MP4 fragmentado por sesión, permaneciendo en reposo hasta recibir el comando start, de modo que en idle no consume CPU ni NVENC ni mantiene conexión con la cámara.

Al recibir start, el worker se conecta al camera-worker, selecciona el codificador disponible según la plataforma y graba hasta recibir el comando stop, mientras el bitrate se autoescala según la altura del frame. La Tabla 3 resume los codificadores posibles según la plataforma.

| Plataforma | Codificador | Bitrate (1080p / 720p) |
| --- | --- | --- |
| Jetson Xavier (GStreamer) | nvv4l2h264enc | 12 / 8 Mbps |
| Desktop NVIDIA (PyAV) | h264_nvenc | 12 / 8 Mbps |
| Sin GPU (PyAV fallback) | libx264 | 9 / 6 Mbps |
^TABLA 3. Backends de codificación seleccionados por el recording-worker.

Sobre Jetson, el plugin nvv4l2h264enc se entrega con el paquete nvidia-l4t-gstreamer de JetPack, por lo que el script de despliegue verifica con gst-inspect-1.0 que el plugin esté disponible antes de habilitar la unidad systemd.

### 3.3.4 conversion-worker

La función principal del conversion-worker es construir engines TensorRT FP16 a partir de modelos .pt usando el método export() de Ultralytics, atendiendo solicitudes por /tmp/conversion.sock y procesando una conversión a la vez, de modo que si llega una segunda mientras hay otra en curso el worker responde 409.

Cada engine se cachea con el sha256 del .pt incrustado en el nombre del archivo, lo que invalida la cache automáticamente cuando el modelo se reentrena.

En la Jetson, el venv del worker se crea con `uv venv --system-site-packages` para heredar los bindings de tensorrt que provee JetPack vía el paquete python3-libnvinfer.


![FIGURA 3. Tarjeta «Modelos asignados» en /settings, donde el operador activa la aceleración TensorRT FP16 por modelo.](assets/2026-05-06-21-38-45.png)


## 3.4 Aceleración con TensorRT FP16

La Jetson Xavier integra Tensor Cores que aceleran operaciones de matriz en FP16 sobre los SM (streaming multiprocessors), recursos que PyTorch FP32 no utiliza al ejecutar el modelo .pt, por lo que la conversión a un engine TensorRT FP16 reduce la latencia por frame y eleva el FPS efectivo. La Tabla 4 resume la latencia de inferencia aislada (percentiles p50 y p99 sobre 600 frames a 640x640 con `sudo jetson_clocks`) y el FPS efectivo medido de extremo a extremo sobre el flujo de producción del robot.

<!-- widths: 3120,2080,2080,2080 -->
| Backend de inferencia | Latencia p50 | Latencia p99 | FPS efectivo |
| --- | --- | --- | --- |
| PyTorch FP32 (.pt) sobre CUDA | ~75 ms | ~85 ms | 9 |
| TensorRT FP16 (.engine) | 50,9 ms | 57,0 ms | 14 |
^TABLA 4. Rendimiento de inferencia YOLO sobre Jetson Xavier (latencia de inferencia aislada y FPS efectivo medido de extremo a extremo).

El operador activa o desactiva TensorRT por modelo desde la card "Modelos asignados" en /settings, disponible únicamente en modo robot, donde al activar el toggle el conversion-worker construye el engine FP16 a partir del .pt y, al terminar, el inference-worker recarga el modelo en caliente sin interrumpir el streaming.

## 3.5 Descripción del backend

El backend es una aplicación FastAPI que actúa como coordinador central, comunicándose con el frontend mediante HTTP y con los workers mediante sockets Unix.

El backend cumple tres roles que se entrelazan. Orquesta a los workers, ya que decide qué modelo cargar, qué resolución usar y cuándo grabar, traduciendo las acciones del operador en comandos hacia el worker correspondiente porque los workers no se comunican entre sí. Expone los endpoints REST y la conexión WebRTC que la interfaz consume, y persiste sesiones, eventos y configuración en la base de datos local mientras ejecuta el loop de sincronización con el servidor central cuando hay conectividad.

La Tabla 5 resume los comandos que el backend dirige a cada worker.

| Worker | Comandos típicos |
| --- | --- |
| camera-worker | `reload` (cambia la resolución 720p o 1080p) |
| inference-worker | `reload_model` (carga un nuevo `.pt` o `.engine`) |
| recording-worker | `start`, `stop` (controlan la grabación de la sesión) |
| conversion-worker | `convert` (encola un build TensorRT) |
^TABLA 5. Comandos que el backend dirige a cada worker.

Una sesión de conteo es la unidad de trabajo principal del sistema y sigue los siguientes pasos:

1. El operador inicia la sesión desde el frontend, indicando camellón, clase objetivo y modelo.
2. El backend ordena al recording-worker que empiece a grabar el stream.
3. Por cada frame que llega del camera-worker, el backend lo envía al inference-worker y reenvía las detecciones al frontend por el data channel de WebRTC.
4. Cuando un objeto cruza la línea configurada, el backend registra el evento en SQLite asociado a la sesión.
5. Al finalizar, el backend ordena al recording-worker el cierre y enlaza el archivo MP4 resultante con la sesión.

En modo robot, un loop de sincronización en segundo plano se activa cuando detecta conectividad y se ejecuta cada 30 segundos en dos fases, donde la fase push envía los registros locales no sincronizados al servidor y la fase pull descarga los modelos asignados al robot.

En modo servidor, los endpoints están protegidos con autenticación JWT (rol admin o viewer, asociado a una empresa), mientras los endpoints de sincronización usan la API key del dispositivo.

## 3.6 Descripción del frontend

El frontend es una aplicación React 19 con TypeScript que se compila a archivos estáticos servidos por nginx, donde la interfaz se adapta según el valor de `ROBOT_MODE` y el rol declarado en el JWT del usuario.

En modo robot, la interfaz principal es el módulo de visión, donde el operador visualiza el video en tiempo real con las detecciones superpuestas, configura la línea de conteo, selecciona el camellón y la clase objetivo, alterna la resolución entre 720p y 1080p, e inicia sesiones de conteo, mientras que la página /settings expone la tarjeta "Modelos asignados" desde la cual se activa TensorRT por modelo, tras lo cual el frontend consulta el estado de la conversión cada 5 segundos hasta que el engine quede listo.

En modo servidor, la interfaz incluye autenticación con JWT y páginas de administración para usuarios, empresas, fundos, modelos y dispositivos, con visibilidad restringida a la empresa propia para los usuarios de rol visualizador. Ambos modos comparten el módulo de mapa, basado en Google Maps con la ubicación de fundos y conteos acumulados, y el módulo de tablero, con indicadores y tendencias por fecha y camellón.



![FIGURA 4. Interfaz del modo robot mostrando el módulo de visión con el video en tiempo real recibido por WebRTC.](assets/2026-05-06-21-34-01.png)



![FIGURA 5. Página /settings del modo robot con la tarjeta de configuración de modelos asignados al dispositivo.](assets/2026-05-06-21-37-07.png)


![FIGURA 6. Interfaz del modo servidor con páginas de administración de usuarios, empresas, fundos, modelos y dispositivos.](assets/2026-05-06-21-36-04.png)

## 3.7 Despliegue

Para instalar el sistema se usa el script `deploy/install.sh <modo>` (robot o servidor), el cual registra todos los servicios en systemd de modo que arrancan al encender el equipo y se reinician ante fallos, mientras que la administración del robot en producción se realiza con los comandos de la Tabla 6.

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
^TABLA 6. Comandos de operación del robot.

## 3.8 Incidencias y funcionalidades pendientes

Durante la integración se identificó una incidencia operativa, descrita en la Tabla 7, la cual no bloquea la operación normal del robot ni la inferencia y solo requiere una acción manual del operador para reanudar la conversión TensorRT.

<!-- widths: 600,2600,3000,1700,1100 -->
| # | Incidencia | Descripción | Impacto | Severidad |
| --- | --- | --- | --- | --- |
| 1 | Conversión TensorRT no se recupera tras reinicio del backend | Si el backend se reinicia mientras un engine se está construyendo, la fila queda en estado converting hasta que el reconciliador de arranque la marca como error con el mensaje "Backend reiniciado durante conversión". El operador debe pulsar Reintentar. | Requiere reintento manual | No crítica |
^TABLA 7. Incidencias detectadas en integración.

Como funcionalidades planificadas aún no liberadas a producción quedan las siguientes:

- Despliegue del servidor central en la computadora del laboratorio
- Implementación de mapa sin conexión para operación en zonas sin red
- Soporte de cámara IP por red local
- Pipeline de clasificación sin conexión de frutos por madurez

# IV. EVALUACIÓN DE MODELOS DE IA

Esta sección resume la evaluación cuantitativa de tres familias de modelos de detección de objetos sobre el dataset propio de arándanos recolectado en los campos del fundo Danper. La evaluación detallada de arquitecturas, curvas de entrenamiento y análisis de errores se presenta en el informe técnico #2 (Cubas, 2025). Aquí se reportan los algoritmos evaluados, las métricas empleadas, los resultados por modelo y el estado actual de la integración del modelo de producción.


## 4.1 Algoritmo de conteo por cruce de línea

El sistema combina detección por YOLO, seguimiento de objetos con BoT-SORT y un algoritmo de cruce de línea para contar frutos que atraviesan una línea virtual configurada por el operador. El componente de conteo está implementado en `back/services/perception/object_counter.py` (clase `ObjectCounter`).

BoT-SORT recibe los cuadros delimitadores producidos por YOLO en cada frame y les asigna un identificador persistente (`track_id`) que se mantiene entre frames mientras el objeto permanezca visible. A partir de cada cuadro delimitador, el inference-worker calcula el centroide (cx, cy) y lo normaliza al rango [0, 1] dividiéndolo por el ancho y alto del frame antes de enviarlo al backend, de modo que el umbral de la línea sea independiente de la resolución de captura.

El operador configura tres parámetros: el modo (`vertical` u `horizontal`), la dirección (`top2down`, `down2top`, `left2right` o `right2left`) y la posición de la línea (umbral en [0, 1]). Estos parámetros definen una función booleana `count_condition(coord)` que determina si un track se encuentra en el lado "después" de la línea.



![FIGURA 7. Configuración de los parámetros del algoritmo de conteo por cruce de línea (modo, dirección y posición) desde el módulo de visión.](assets/2026-05-06-21-37-48.png)

Para validar el cruce, el contador mantiene dos conjuntos de `track_id`. LIST_0 acumula los `track_id` de los objetos seguidos que en algún frame anterior fueron observados en el lado "antes" de la línea y actúa como precondición. LIST_1 contiene los `track_id` ya contados, es decir, aquellos que pasaron al lado "después" habiendo estado antes en LIST_0; el cardinal de LIST_1 es el conteo total reportado en la sesión.

El procedimiento que sigue el algoritmo, para cada objeto seguido recibido del inference-worker en un frame, es el siguiente:

1. Se selecciona la coordenada relevante según el modo: `x = cx` si es horizontal, `y = cy` si es vertical.
2. Si `count_condition(coord)` se cumple (lado "después"), el `track_id` se agrega a LIST_1 solo si ya pertenecía a LIST_0, lo que evita contar objetos que aparecen en el lado "después" sin haber sido vistos antes (oclusiones, entradas por borde).
3. Si `count_condition(coord)` no se cumple (lado "antes"), el `track_id` se agrega a LIST_0 y se elimina de LIST_1 si estaba presente, de modo que un objeto que regresa al lado original descuenta del total.

El `track_id` asignado por BoT-SORT garantiza la idempotencia entre frames: un mismo objeto que permanece varios frames en el lado "después" solo incrementa el contador una vez. La operación con conjuntos (`set.add`, `set.discard`) hace que el costo sea O(n) por frame con n objetos seguidos visibles.

La Tabla 8 resume los modos de conteo soportados.

<!-- widths: 2340,2340,4680 -->
| Modo | Dirección | Condición de conteo |
| --- | --- | --- |
| Vertical | top2down | Objeto cruza de arriba hacia abajo (cy > threshold) |
| Vertical | down2top | Objeto cruza de abajo hacia arriba (cy < threshold) |
| Horizontal | left2right | Objeto cruza de izquierda a derecha (cx > threshold) |
| Horizontal | right2left | Objeto cruza de derecha a izquierda (cx < threshold) |
^TABLA 8. Modos de conteo por cruce de línea.


## 4.2 Algoritmos evaluados

Las evaluaciones reportadas en esta sección corresponden al entrenamiento estándar de los modelos de detección sobre el dataset de arándanos, midiendo la calidad de la detección por frame (mAP, F1, precisión, recall) y no el error del algoritmo de conteo descrito en la sección 4.1, cuya validación de extremo a extremo sobre frutos en campo se reporta como tarea pendiente en la sección 4.5. Bajo este alcance se entrenaron y evaluaron tres familias de modelos YOLO, cuyo origen y contribución técnica se sintetizan en la Tabla 9.

| Modelo | Origen | Contribución técnica |
| --- | --- | --- |
| YoloV9 | Wang et al. (2024), Academia Sinica | Introduce Programmable Gradient Information y la arquitectura RepNCSPELAN para preservar información gradiente en redes profundas. |
| YoloV10 | Wang et al. (2024), Tsinghua University | Elimina la operación NMS mediante un esquema de asignación dual one-to-many y one-to-one durante el entrenamiento. |
| YoloV11 | Ultralytics (2024) | Introduce el bloque C3k2 en el backbone y el bloque C2PSA con atención posicional, manteniendo compatibilidad con el ecosistema Ultralytics. |
^TABLA 9. Algoritmos de detección evaluados.

El dataset de entrenamiento consta de 800 imágenes no públicas de arándanos, recolectadas por el equipo en los campos del fundo Danper y etiquetadas manualmente con cuadros delimitadores, sobre el cual cada modelo se entrenó variando dos hiperparámetros: backbone (Tiny/Small/Medium/Large/Compact según corresponda al modelo) y número de épocas (50, 100, 150, 200), produciendo entre 16 y 20 configuraciones por familia.

## 4.3 Métricas de evaluación

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

## 4.4 Resultados por modelo

Las Tablas 11, 12 y 13 reportan los resultados de entrenamiento de YoloV9, YoloV10 y YoloV11 respectivamente. Los valores se transcriben del informe técnico #2.

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tiny | 50 | 2,006 | 0,8133 | 0,4621 | 0,7551 | 0,7668 | 0,7437 | 0,5413 | 0,3306 |
| Tiny | 100 | 2,006 | 0,8225 | 0,4702 | 0,7598 | 0,7727 | 0,7474 | 0,5819 | 0,3833 |
| Tiny | 150 | 2,006 | 0,8264 | 0,4806 | 0,7646 | 0,7724 | 0,7558 | 0,5663 | 0,4026 |
| Tiny | 200 | 2,006 | 0,824 | 0,4788 | 0,7639 | 0,7685 | 0,7592 | 0,5725 | 0,3979 |
| Small | 50 | 7,288 | 0,8311 | 0,4809 | 0,7665 | 0,7745 | 0,7586 | 0,45 | 0,3438 |
| Small | 100 | 7,288 | 0,8346 | 0,4918 | 0,7714 | 0,7745 | 0,7682 | 0,5196 | 0,4006 |
| Small | 150 | 7,288 | 0,8341 | 0,4915 | 0,7706 | 0,7741 | 0,7752 | 0,4409 | 0,2993 |
| Small | 200 | 7,288 | 0,8328 | 0,495 | 0,7697 | 0,7772 | 0,7623 | 0,4006 | 0,2904 |
| Medium | 50 | 20,159 | 0,8348 | 0,4927 | 0,7702 | 0,7677 | 0,7728 | 0,4271 | 0,2546 |
| Medium | 100 | 20,159 | 0,8348 | 0,4927 | 0,7702 | 0,7677 | 0,7728 | 0,4271 | 0,2546 |
| Medium | 150 | 20,159 | 0,8394 | 0,4949 | 0,7741 | 0,7642 | 0,7842 | 0,4804 | 0,3461 |
| Medium | 200 | 20,159 | 0,8373 | 0,4945 | 0,7681 | 0,7559 | 0,7808 | 0,5566 | 0,3853 |
| Compact | 50 | 25,53 | 0,833 | 0,4902 | 0,7697 | 0,7685 | 0,7709 | 0,44 | 0,2804 |
| Compact | 100 | 25,53 | 0,8299 | 0,4886 | 0,7685 | 0,7721 | 0,765 | 0,4653 | 0,3238 |
| Compact | 150 | 25,53 | 0,8327 | 0,4926 | 0,77 | 0,7775 | 0,7626 | 0,4186 | 0,3118 |
| Compact | 200 | 25,53 | 0,8407 | 0,4939 | 0,7703 | 0,7679 | 0,7727 | 0,5723 | 0,4350 |
^TABLA 11. Resultados del entrenamiento del modelo YoloV9 con 800 imágenes de arándanos recolectadas en los campos del fundo Danper.

YoloV9 alcanza el mAP@0.5 más alto del estudio con la variante Compact a 200 épocas (0,8407). En las variantes Tiny, Small y Medium se observa una tendencia al sobreajuste a partir de 100 épocas, donde el mAP@0.5:0.95 se estabiliza o decrece pese al incremento de épocas.

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nano | 50 | 2,707 | 0,7894 | 0,4468 | 0,7364 | 0,7459 | 0,7272 | 0,6044 | 0,4471 |
| Nano | 100 | 2,707 | 0,8066 | 0,4651 | 0,7471 | 0,7514 | 0,7428 | 0,4904 | 0,3832 |
| Nano | 150 | 2,707 | 0,816 | 0,4721 | 0,7529 | 0,7664 | 0,74 | 0,4997 | 0,3991 |
| Nano | 200 | 2,707 | 0,8136 | 0,4706 | 0,7504 | 0,741 | 0,76 | 0,4977 | 0,3427 |
| Small | 50 | 8,067 | 0,8238 | 0,4762 | 0,759 | 0,7568 | 0,7612 | 0,5546 | 0,3877 |
| Small | 100 | 8,067 | 0,8261 | 0,482 | 0,7606 | 0,7647 | 0,7566 | 0,5068 | 0,3651 |
| Small | 150 | 8,067 | 0,8245 | 0,4845 | 0,7591 | 0,7567 | 0,7614 | 0,4811 | 0,3583 |
| Small | 200 | 8,067 | 0,8188 | 0,4804 | 0,7595 | 0,7604 | 0,7587 | 0,4818 | 0,3583 |
| Medium | 50 | 16,485 | 0,828 | 0,4817 | 0,7616 | 0,755 | 0,7683 | 0,466 | 0,3391 |
| Medium | 100 | 16,485 | 0,8309 | 0,4905 | 0,765 | 0,7717 | 0,7584 | 0,4717 | 0,3465 |
| Medium | 150 | 16,485 | 0,8305 | 0,4918 | 0,7628 | 0,7685 | 0,7571 | 0,3769 | 0,2674 |
| Medium | 200 | 16,485 | 0,8275 | 0,4905 | 0,7619 | 0,7572 | 0,7667 | 0,3867 | 0,3044 |
| Large | 50 | 25,767 | 0,8292 | 0,486 | 0,764 | 0,7588 | 0,7694 | 0,444 | 0,3088 |
| Large | 100 | 25,767 | 0,8231 | 0,489 | 0,7591 | 0,7614 | 0,7569 | 0,5225 | 0,419 |
| Large | 150 | 25,767 | 0,8116 | 0,4791 | 0,753 | 0,7424 | 0,7638 | 0,3991 | 0,2923 |
| Large | 200 | 25,767 | 0,8097 | 0,486 | 0,7591 | 0,7543 | 0,7607 | 0,4472 | 0,3743 |
^TABLA 12. Resultados del entrenamiento del modelo YoloV10 con 800 imágenes de arándanos recolectadas en los campos del fundo Danper.

YoloV10 sigue un patrón similar a YoloV9 en backbones grandes: las variantes Medium y Large muestran caída de mAP@0.5 entre 100 y 200 épocas, indicador de sobreajuste con el tamaño del dataset. El máximo se obtiene con Medium a 100 épocas (0,8309).

<!-- widths: 1300,1100,1300,1500,1700,1500,1500,1500,1500,1500 -->
| Backbone | Épocas | Params (M) | mAP@0.5 | mAP@0.5:0.95 | F1@0.5 | Precisión@0.5 | Recall@0.5 | mError@0.5 | mError@0.3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nano | 50 | 2,59 | 0,8091 | 0,4573 | 0,7504 | 0,7601 | 0,741 | 0,5755 | 0,3738 |
| Nano | 100 | 2,59 | 0,8153 | 0,4663 | 0,7548 | 0,7692 | 0,7409 | 0,4841 | 0,3279 |
| Nano | 150 | 2,59 | 0,821 | 0,4734 | 0,7599 | 0,7639 | 0,756 | 0,5067 | 0,3487 |
| Nano | 200 | 2,59 | 0,8228 | 0,4728 | 0,7623 | 0,7672 | 0,7574 | 0,4529 | 0,3151 |
| Small | 50 | 9,428 | 0,8311 | 0,4802 | 0,7695 | 0,7725 | 0,7666 | 0,4911 | 0,3183 |
| Small | 100 | 9,428 | 0,8295 | 0,4859 | 0,7663 | 0,7677 | 0,7648 | 0,4304 | 0,3239 |
| Small | 150 | 9,428 | 0,8338 | 0,4925 | 0,7675 | 0,7684 | 0,7666 | 0,4982 | 0,3685 |
| Small | 200 | 9,428 | 0,8293 | 0,4914 | 0,7627 | 0,756 | 0,758 | 0,4562 | 0,3402 |
| Medium | 50 | 20,054 | 0,8265 | 0,4862 | 0,7638 | 0,7558 | 0,7719 | 0,4281 | 0,3054 |
| Medium | 100 | 20,054 | 0,833 | 0,4946 | 0,7677 | 0,7672 | 0,7682 | 0,4434 | 0,3055 |
| Medium | 150 | 20,054 | 0,831 | 0,4929 | 0,7629 | 0,7765 | 0,7499 | 0,3966 | 0,2901 |
| Medium | 200 | 20,054 | 0,8262 | 0,493 | 0,7664 | 0,7685 | 0,7642 | 0,4166 | 0,3087 |
| Large | 50 | 25,311 | 0,8293 | 0,4884 | 0,7625 | 0,7706 | 0,7544 | 0,4437 | 0,296 |
| Large | 100 | 25,311 | 0,8335 | 0,4951 | 0,7693 | 0,7748 | 0,7639 | 0,4114 | 0,3035 |
| Large | 150 | 25,311 | 0,8274 | 0,4921 | 0,7625 | 0,7552 | 0,7699 | 0,4219 | 0,3027 |
| Large | 200 | 25,311 | 0,8278 | 0,4929 | 0,7657 | 0,7607 | 0,7708 | 0,4412 | 0,347 |
^TABLA 13. Resultados del entrenamiento del modelo YoloV11 con 800 imágenes de arándanos recolectadas en los campos del fundo Danper.

YoloV11 no muestra el comportamiento decreciente observado en YoloV9 y YoloV10 al aumentar las épocas. Los valores de mAP@0.5 se mantienen en una banda de 0,8091 a 0,8338 (rango 0,0247) frente a 0,0274 en YoloV9 y 0,0415 en YoloV10 sobre el mismo barrido de configuraciones. El máximo se obtiene con Small a 150 épocas (0,8338) y Large a 100 épocas (0,8335), con variantes Medium muy próximas.

## 4.5 Modelo de producción y estado de la integración

La Tabla 14 reporta el mAP@0.5 máximo de cada familia y la configuración correspondiente sobre el dataset propio recolectado en Danper.

| Modelo | Backbone | Épocas | mAP@0.5 | mAP@0.5:0.95 |
| --- | --- | --- | --- | --- |
| YoloV9 | Compact | 200 | 0,8407 | 0,4939 |
| YoloV10 | Medium | 100 | 0,8309 | 0,4905 |
| YoloV11 | Small | 150 | 0,8338 | 0,4925 |
^TABLA 14. Mejor configuración por familia de modelos sobre el dataset propio recolectado en Danper.

YoloV9-Compact-200 obtiene el mAP@0.5 más alto del estudio en la tarea de detección por frame y se selecciona como modelo candidato de producción. Queda por verificar si esta ventaja en detección se traduce en mejor desempeño en la tarea de conteo, dado que un mejor mAP no garantiza menor error de conteo cuando el algoritmo depende también del seguimiento entre frames y de la estabilidad del `track_id`. La integración del modelo en la plataforma está en curso y aún no se ha completado.

Las tareas pendientes para integrar el modelo de producción YoloV9 son:

1. Empaquetar el checkpoint YoloV9-Compact-200 entrenado sobre el dataset propio recolectado en Danper en el formato que el inference-worker carga.
2. Componer el detector YoloV9 con el algoritmo de seguimiento BoT-SORT, ya que el repositorio de los autores no expone el equivalente a `model.track()` de Ultralytics y requiere un envoltorio.
3. Habilitar la conversión a TensorRT FP16 desde el conversion-worker, lo cual requiere para YoloV9 un paso intermedio por ONNX y la verificación de capas soportadas por la versión de TensorRT incluida en JetPack 5.1.
4. Validar la métrica mAP@0.5 sobre frutos reales en sesión de campo, una vez integrado el modelo en el flujo de producción del robot.

# V. CONCLUSIONES

1. La arquitectura por procesos independientes resuelve los problemas de aislamiento de fallos, desacoplamiento de tasas de frame y conflictos de versiones de Python que presentaba el sistema monolítico anterior. Captura, inferencia y grabación operan en simultáneo a 1080p y 30 FPS sin acumulación de buffers ni regresión en el módulo de visión.
2. La aceleración con TensorRT FP16 sobre los Tensor Cores de la Jetson Xavier reduce la latencia de inferencia aislada de 75 ms a 50,9 ms en el percentil 50 y eleva el FPS efectivo medido de extremo a extremo de 9 a 14, manteniendo el modelo intacto sin alterar la métrica de detección.
3. Los tres modelos evaluados alcanzan mAP@0.5 superiores a 0,83 sobre el dataset propio recolectado en Danper. YoloV9-Compact-200 obtiene el máximo (0,8407) y queda seleccionado como el modelo de producción para la detección de frutos. Su integración en la plataforma está en curso e implica empaquetar el checkpoint, componer un wrapper con BoT-SORT y habilitar la conversión a TensorRT FP16 desde el conversion-worker.
4. Mientras se completa esa integración, la plataforma carga YoloV11 preentrenado de Ultralytics como modelo de validación de extremo a extremo, lo que permite verificar sobre el robot real la detección, el algoritmo de conteo por cruce de línea, el pipeline TensorRT y la sincronización de modelos sin depender de la disponibilidad estacional de arándanos en campo.
5. Los próximos pasos cubren la integración del modelo de producción YoloV9, la reducción del overhead del wrapper de Ultralytics en el flujo de inferencia (donde el modelo puro corre a 16 ms y `model.track()` añade ~35 ms de envoltura), el despliegue del servidor central en la PC del laboratorio y el pipeline de clasificación offline de frutos por madurez y calidad.

# VI. REFERENCIAS

Aharon, N., Orfaig, R. y Bobrovsky, B.-Z. (2022). BoT-SORT: Robust Associations Multi-Pedestrian Tracking. arXiv:2206.14651. https://arxiv.org/abs/2206.14651

Cubas, P. (2025). Informe técnico #2: Evaluación de algoritmos de detección de objetos para conteo de arándanos. Proyecto PE5010-86701-2024-PROCIENCIA, Universidad Privada Antenor Orrego.

Cubas, P. (2026). Informe técnico #3: Plataforma de software del robot móvil agrícola, versión inicial. Proyecto PE5010-86701-2024-PROCIENCIA, Universidad Privada Antenor Orrego.

Ultralytics. (2024). YOLO11: Documentation and release notes. https://docs.ultralytics.com/models/yolo11/

Wang, A., Chen, H., Liu, L., Chen, K., Lin, Z., Han, J. y Ding, G. (2024). YOLOv10: Real-Time End-to-End Object Detection. arXiv:2405.14458. https://arxiv.org/abs/2405.14458

Wang, C.-Y., Yeh, I.-H. y Liao, H.-Y. M. (2024). YOLOv9: Learning What You Want to Learn Using Programmable Gradient Information. arXiv:2402.13616. https://arxiv.org/abs/2402.13616
