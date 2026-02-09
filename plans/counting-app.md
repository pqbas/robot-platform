# App de Conteo de Objetos - Agricultura (Arandanos)

## Concepto

Aplicacion para el sector agricola que cuenta objetos (frutos, personas, etc.)
visibles en la camara. Caso de uso principal: conteo de arandanos en camellones
durante cosecha o inspeccion.

**Fake count (v1):** el conteo no usa tracking ni linea de cruce. Simplemente
detecta los objetos en el frame actual con YOLO y guarda ese numero como
resultado. Esto permite tener el flujo completo funcional sin complejidad
de tracking. En versiones futuras se puede reemplazar por conteo real.

Cada sesion de conteo esta asociada a un **camellon** especifico, permitiendo
llevar registro por ubicacion dentro del campo.

Tres modulos principales en el frontend: **Vision**, **Registro** y **Mapa**.

---

## Modulo 1: Vision

Pantalla principal. Muestra el streaming en vivo, controla el conteo
y permite guardar el resultado al finalizar.

### Funcionalidades

- **Stream en vivo** via WebRTC (ya existe)
- **Configuracion previa al conteo:**
  - Selector de clase: que contar (arandanos, personas, cajas, etc.)
- **Deteccion en vivo** - YOLO detecta objetos en cada frame y dibuja bboxes
- **Contador en vivo** - overlay sobre el video mostrando cuantos objetos de la
  clase seleccionada hay en el frame actual
- **Fake count** - al detener, el conteo guardado es la cantidad de objetos
  detectados en el ultimo frame procesado

### Flujo de uso

```
1. Usuario ve el stream en vivo
   Configura la clase a detectar
   Presiona [ Iniciar conteo ]

2. El sistema detecta objetos con YOLO en cada frame
   El video muestra bboxes y contador en vivo (objetos en frame actual)
   El selector de clase se deshabilita

3. Usuario presiona [ Detener conteo ]
   El sistema toma el ultimo frame procesado y cuenta los objetos detectados

4. Aparece dialogo de guardado:
   +------------------------------------------+
   |  Guardar registro de conteo              |
   |                                          |
   |  Conteo: 12 arandanos (ultimo frame)     |
   |  Duracion: 12m 34s                       |
   |                                          |
   |  Camellon: [___________]  (obligatorio)  |
   |                                          |
   |  [ Descartar ]          [ Guardar ]      |
   +------------------------------------------+

   - Si el campo camellon esta vacio y presiona Guardar,
     se muestra mensaje: "Indica el camellon para guardar"
   - Si completa camellon y confirma -> se guarda en BD
   - Si descarta -> el conteo se pierde

5. Vuelve al estado inicial (paso 1)
```

### Estados del modulo

```
IDLE        ->  stream visible, controles habilitados, boton [Iniciar conteo]
COUNTING    ->  stream + conteo activo, controles deshabilitados, boton [Detener conteo]
SAVING      ->  dialogo de guardado visible sobre el video
```

### Vista (estado COUNTING)

```
+----------------------------------------------------------+
|  [Vision]   [Registro]   [Mapa]                          |
+----------------------------------------------------------+
|                                                          |
|   +----------------------------------------------+       |
|   |                           En frame: 12       |       |
|   |          VIDEO STREAM                        |       |
|   |                                              |       |
|   |   [arandano]  [arandano]                     |       |
|   |                    [arandano]                 |       |
|   |        [arandano]                             |       |
|   |                                              |       |
|   +----------------------------------------------+       |
|                                                          |
|   Clase: arandano                                        |
|                                                          |
|   [ Detener conteo ]                                     |
|                                                          |
+----------------------------------------------------------+
```

### Backend necesario

**Deteccion (ya existe parcialmente):**
- `model(frame)` detecta objetos y retorna bboxes + clases
- Filtrar por la clase seleccionada por el usuario
- Contar objetos de esa clase en cada frame

**Fake count (v1):**
- Al detener la sesion, se toma la cantidad de objetos detectados en el
  ultimo frame como el resultado del conteo
- No requiere tracking ni logica de cruce de linea por ahora
- En el futuro se reemplaza por conteo real con tracking + linea de cruce

**Data channel:**
- Enviar al frontend por cada frame:
  - Cantidad de objetos de la clase seleccionada en el frame actual
  - Objetos visibles (clase, bbox)

---

## Modulo 2: Registro

Pantalla de consulta. Muestra el historial de conteos guardados desde Vision.

### Funcionalidades

- **Tabla de registros** - lista de conteos guardados
  - Camellon
  - Fecha/hora
  - Clase contada
  - Total contado (objetos en ultimo frame)
- **Filtros** - filtrar por camellon, clase, rango de fechas

- **Resumen por camellon** - vista agrupada: total contado por camellon
- **Detalle de sesion** - al hacer click en un registro:
  - Grafico temporal (objetos contados por minuto/hora)
  - Lista de eventos individuales (timestamp + clase)
- **Exportar** - descargar datos en CSV

### Vista

```
+----------------------------------------------------------+
|  [Vision]   [Registro]   [Mapa]                          |
+----------------------------------------------------------+
|                                                          |
|   Sesiones de conteo                                     |
|   +----------------------------------------------------+ |
|   | Camellon | Fecha            | Clase     | Conteo     | |
|   |------------------------------------------------------| |
|   |    14    | 2026-02-03 14:30 | arandano  |    12      | |
|   |    14    | 2026-02-03 10:15 | arandano  |     8      | |
|   |     7    | 2026-02-02 09:00 | arandano  |    15      | |
|   |     3    | 2026-02-01 11:00 | persona   |     3      | |
|   +----------------------------------------------------+ |
|                                                          |
|   [ Exportar CSV ]                                       |
|                                                          |
+----------------------------------------------------------+
```

### Backend necesario

**Persistencia (nuevo):**
- SQLite para almacenar sesiones y eventos
- Tablas:
  - `camellones`: id, nombre, lat, lng
  - `sessions`: id, camellon_id (FK), start_time, end_time, target_class, direction, total_count
  - `events`: id, session_id, timestamp, object_class, track_id

**Rutas nuevas:**
```
GET  /api/sessions              -> lista de sesiones
GET  /api/sessions/{id}         -> detalle de una sesion
GET  /api/sessions/{id}/events  -> eventos de una sesion
GET  /api/sessions/{id}/export  -> CSV
POST /api/sessions/start        -> inicia sesion de conteo {camellon, target_class, direction}
POST /api/sessions/stop         -> detiene sesion de conteo
GET  /api/camellones/summary    -> conteo total agrupado por camellon
```

---

## Modulo 3: Mapa

Pantalla de visualizacion geografica. Muestra los camellones sobre Google Maps
con informacion resumida de conteo, permitiendo ver de un vistazo el estado
de produccion de todo el campo.

### Funcionalidades

- **Mapa interactivo** - Google Maps con vista satelital del campo
- **Marcadores por camellon** - cada camellon registrado aparece como un marcador
  en el mapa con su numero identificador
- **Color por produccion** - marcadores con color segun nivel de conteo:
  - Rojo: bajo (por debajo del umbral minimo)
  - Amarillo: medio
  - Verde: alto (por encima del umbral esperado)
- **InfoWindow al hacer click** - al presionar un marcador se muestra:
  - Numero de camellon
  - Total acumulado de conteo (todas las sesiones)
  - Cantidad de sesiones realizadas
  - Ultimo conteo: fecha y cantidad
  - Clase principal contada
- **Heatmap toggle** - alternar entre marcadores individuales y mapa de calor
  basado en densidad de conteo
- **Filtros** - filtrar por clase contada y rango de fechas
- **Geocodificacion de camellones** - asociar coordenadas GPS a cada camellon
  - Al crear un camellon por primera vez (o si no tiene coordenadas),
    el usuario puede hacer click en el mapa para asignar ubicacion
  - Las coordenadas se guardan en la BD para futuras sesiones

### Flujo de uso

```
1. Usuario navega al modulo Mapa
   El mapa carga centrado en la ubicacion del campo

2. Se muestran marcadores para cada camellon que tenga coordenadas
   Marcadores coloreados segun nivel de produccion

3. Click en un marcador -> InfoWindow con resumen del camellon
   +------------------------------------------+
   |  Camellon 14                             |
   |                                          |
   |  Total acumulado: 1,248 arandanos        |
   |  Sesiones: 4                             |
   |  Ultimo conteo: 2026-02-03 14:30 (347)   |
   |                                          |
   |  [ Ver sesiones ]                        |
   +------------------------------------------+

   - "Ver sesiones" navega al modulo Registro filtrado por ese camellon

4. Si un camellon no tiene coordenadas asignadas:
   - Aparece en una lista lateral "Camellones sin ubicacion"
   - El usuario selecciona uno y hace click en el mapa para ubicarlo
   - Se guarda la coordenada via API
```

### Vista

```
+----------------------------------------------------------+
|  [Vision]   [Registro]   [Mapa]                          |
+----------------------------------------------------------+
|                                                          |
|  Filtros: Clase [arandano v]  Fecha [desde] - [hasta]   |
|                                                          |
|  +---------------------------+-----------------------+   |
|  |                           |  Sin ubicacion:       |   |
|  |     GOOGLE MAPS           |  - Camellon 21        |   |
|  |                           |  - Camellon 22        |   |
|  |    (14)●  ●(7)            |                       |   |
|  |              ●(3)         |  [Heatmap: OFF]       |   |
|  |                           |                       |   |
|  |                           |                       |   |
|  +---------------------------+-----------------------+   |
|                                                          |
+----------------------------------------------------------+
```

### Backend necesario

**Tabla nueva en SQLite:**
- `camellones`: id, nombre, lat, lng
  - El campo `camellon` en `sessions` pasa a ser FK a esta tabla
  - Migracion: crear tabla y vincular sesiones existentes

**Rutas nuevas:**
```
GET  /api/camellones                -> lista de camellones con coordenadas
POST /api/camellones                -> crear camellon {nombre, lat, lng}
PUT  /api/camellones/{id}/location  -> actualizar coordenadas {lat, lng}
GET  /api/camellones/geo-summary    -> resumen por camellon con coordenadas y conteos
                                       [{id, nombre, lat, lng, total_count, session_count, last_session}]
```

### Google Maps API

- Requiere API key de Google Cloud con Maps JavaScript API habilitada
- La key se configura en `config.py` como variable de entorno `GOOGLE_MAPS_API_KEY`
- El backend la sirve al frontend via un endpoint o inyectada en el HTML
- Librerias a cargar: `maps`, `marker`, `visualization` (para heatmap)

---

## Arquitectura

```
back/
    main.py
    config.py
    database.py                     # conexion SQLite, crear tablas
    routes/
        stream.py                   # /offer, /toggle (ya existe)
        counting.py                 # /api/sessions/*
        camellones.py               # /api/camellones/*
    services/
        camera.py                   # captura de video (ya existe)
        perception/
            detector.py             # YOLO detect + track
            counter.py              # logica de linea de conteo + cruce
        storage.py                  # guardar/leer sesiones y eventos en SQLite

front/
    index.html
    css/
        styles.css
    js/
        app.js                      # navegacion entre modulos
        webrtc.js                   # conexion WebRTC + data channel
        vision.js                   # modulo vision: controles, overlay
        registry.js                 # modulo registro: tabla, detalle, export
        map.js                      # modulo mapa: Google Maps, marcadores, heatmap
```

### Flujo de datos

```
Camera frame
      |
      v
model(frame)  -->  objetos detectados (clase, bbox, confianza)
      |
      v
filtrar por clase seleccionada --> contar objetos en frame
      |
      v
frame anotado (bboxes + conteo en frame)
      |
      +-- VideoFrame --> WebRTC video track --> frontend video
      +-- JSON datos --> WebRTC data channel --> frontend overlay

Al detener sesion:
      ultimo frame count --> total_count de la sesion (fake count v1)

--- Futuro (conteo real) ---
model.track(frame)  -->  objetos con IDs persistentes
counter.check_crossings(tracked_objects)  -->  cruce de linea
      +-- storage.save_event() por cada cruce
```

---

## Implementacion por fases

### Fase 1: Fake count + deteccion basica
- Deteccion con `model(frame)` filtrando por clase seleccionada
- Contar objetos en el frame actual y mostrarlo como overlay
- Al detener sesion, guardar conteo del ultimo frame (fake count)
- Data channel para enviar conteo al frontend

### Fase 2: Frontend con tres modulos
- Crear front/ con navegacion Vision / Registro / Mapa
- Vision: stream + controles (on/off, selector clase)
- Conectar data channel para overlay

### Fase 3: Persistencia y registro
- SQLite: tablas camellones, sessions y events
- Rutas API para sesiones y camellones
- Modulo Registro en frontend: tabla + detalle + export CSV

### Fase 4: Mapa geografico
- Rutas API para CRUD de camellones y geo-summary
- Integrar Google Maps JavaScript API en el frontend
- Marcadores por camellon con colores segun produccion
- InfoWindow con resumen de conteo al hacer click
- Asignacion de coordenadas: click en mapa para ubicar camellon
- Panel lateral de camellones sin ubicacion

### Fase 5: Conteo real (reemplaza fake count)
- Cambiar `model(frame)` por `model.track(frame)` en detector
- Implementar logica de linea de conteo + cruce en counter.py
- Selector de direccion en frontend
- Dibujar linea + IDs + conteo acumulado sobre el frame
- Guardar eventos individuales de cruce en tabla events

### Fase 6: Refinamiento
- Selector de posicion de linea (drag en el video)
- Graficos temporales en detalle de sesion
- Filtros por camellon, clase y fecha en registro
- Resumen por camellon (total contado en cada uno)
- Soporte multi-clase simultaneo
- Heatmap toggle en modulo Mapa
- Filtros por clase y fecha en modulo Mapa

---

## Notas sobre modelo YOLO para arandanos

YOLO con pesos COCO (yolo11n.pt) no detecta arandanos directamente.
Opciones para deteccion de arandanos:

1. **Corto plazo**: usar clase generica de COCO (ej: "apple" o "orange" como proxy)
   y validar si funciona visualmente con arandanos en el campo
2. **Mediano plazo**: entrenar modelo custom con dataset de arandanos
   - Recolectar imagenes en campo con la misma camara ZED 2i
   - Anotar con herramienta como Roboflow o CVAT
   - Fine-tune de yolo11n con `model.train(data="arandanos.yaml")`
   - Reemplazar yolo11n.pt por el modelo entrenado
3. **Alternativa**: si los arandanos pasan por una banda transportadora con fondo
   uniforme, se puede usar segmentacion por color (HSV) sin YOLO
