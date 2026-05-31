# Frontend Plan - Counting App

## Stack

- **React 19** + **TypeScript**
- **Vite** como bundler
- **Tailwind CSS** + **shadcn/ui** para UI (tema oscuro por defecto)
- **React Router** para navegacion entre modulos
- **Google Maps JavaScript API** para modulo Mapa

El backend (FastAPI) sirve la API REST y el WebRTC.
El frontend se sirve como archivos estaticos desde el backend o en dev con Vite proxy.

### shadcn/ui

Se usa shadcn/ui para todos los componentes de interfaz. No se personalizan
colores manualmente: se usa el tema oscuro built-in con los defaults de shadcn.

Componentes shadcn a instalar:
- **button** - botones de accion (Iniciar/Detener conteo, Guardar, Exportar)
- **card** - contenedores de contenido (detalle de sesion, InfoPanel)
- **dialog** - modal de guardado post-conteo (SaveDialog)
- **input** - campo de texto (camellon en SaveDialog)
- **label** - etiquetas de formulario
- **select** - selector de clase a detectar
- **table** - tabla de sesiones en Registro
- **badge** - indicadores de estado y clase
- **tabs** - navegacion principal Vision/Registro/Mapa
- **separator** - divisores visuales
- **sonner** (toast) - notificaciones de exito/error al guardar

---

## Estructura del proyecto

```
front/
    package.json
    tsconfig.json
    vite.config.ts
    components.json                     # config shadcn/ui
    index.html
    public/
    src/
        main.tsx                        # entry point, router setup
        App.tsx                         # layout: tabs nav + outlet
        globals.css                     # tailwind base + shadcn CSS variables (dark theme)
        lib/
            utils.ts                    # cn() helper de shadcn
        components/
            ui/                         # componentes shadcn (auto-generados)
                button.tsx
                card.tsx
                dialog.tsx
                input.tsx
                label.tsx
                select.tsx
                table.tsx
                badge.tsx
                tabs.tsx
                separator.tsx
                sonner.tsx
        api/
            client.ts                   # fetch wrapper (base URL, headers)
            sessions.ts                 # GET/POST /api/sessions/*
            camellones.ts               # GET/POST/PUT /api/camellones/*
        hooks/
            useWebRTC.ts                # conexion WebRTC + data channel
            useCounting.ts              # estado de sesion de conteo (IDLE/COUNTING/SAVING)
        types/
            index.ts                    # tipos compartidos
        modules/
            vision/
                VisionPage.tsx          # pagina principal del modulo
                components/
                    VideoStream.tsx      # elemento <video> + WebRTC
                    CountOverlay.tsx     # overlay con conteo en frame
                    ClassSelector.tsx    # <Select> shadcn con clases
                    SaveDialog.tsx       # <Dialog> shadcn para guardado
            registry/
                RegistryPage.tsx        # pagina principal del modulo
                components/
                    SessionsTable.tsx    # <Table> shadcn con sesiones
                    SessionDetail.tsx    # <Card> shadcn con detalle
                    ExportButton.tsx     # <Button> shadcn exportar CSV
            map/
                MapPage.tsx             # pagina principal del modulo
                components/
                    GoogleMap.tsx        # wrapper del mapa
                    CamellonMarker.tsx   # marcador individual
                    InfoPanel.tsx        # <Card> shadcn dentro de InfoWindow
                    UnlocatedList.tsx    # <Card> lateral con lista
```

---

## Tipos principales

```typescript
// types/index.ts

type CountingState = 'IDLE' | 'COUNTING' | 'SAVING';

type DetectionClass = string; // "arandano", "persona", "caja", etc.

type FrameData = {
    count: number;              // objetos de la clase seleccionada en frame actual
    detections: Detection[];    // lista de objetos visibles
};

type Detection = {
    class_name: string;
    bbox: [number, number, number, number]; // x1, y1, x2, y2
    confidence: number;
};

type Session = {
    id: number;
    camellon_id: number;
    camellon_nombre: string;
    start_time: string;         // ISO 8601
    end_time: string | null;
    target_class: string;
    direction: string | null;   // null en fake count v1
    total_count: number;
};

type Camellon = {
    id: number;
    nombre: string;
    lat: number | null;
    lng: number | null;
};

type CamellonGeoSummary = Camellon & {
    total_count: number;
    session_count: number;
    last_session: string | null; // ISO 8601
};
```

---

## Modulo Vision

### Componentes

**VisionPage.tsx** - Pagina contenedora. Maneja el estado de conteo (IDLE/COUNTING/SAVING).

**VideoStream.tsx** - Renderiza el `<video>` conectado via WebRTC.
- Usa el hook `useWebRTC` para establecer la conexion.
- Recibe datos del data channel (conteo en frame, detecciones).

**CountOverlay.tsx** - Overlay posicionado sobre el video.
- Muestra "En frame: N" en la esquina superior derecha.
- Solo visible en estado COUNTING.

**ClassSelector.tsx** - shadcn `<Select>` con las clases disponibles.
- Las clases se obtienen de un endpoint o se hardcodean inicialmente.
- Deshabilitado en estado COUNTING.

**SaveDialog.tsx** - shadcn `<Dialog>` que aparece en estado SAVING.
- Muestra conteo final y duracion con `<Badge>`.
- shadcn `<Input>` + `<Label>` para camellon (obligatorio).
- shadcn `<Button>` para Guardar (default) y Descartar (outline).
- Validacion: camellon no puede estar vacio.
- Toast via `sonner` al guardar exitosamente.

### Hook useWebRTC

```typescript
type UseWebRTCReturn = {
    videoRef: React.RefObject<HTMLVideoElement>;
    connectionState: string;
    frameData: FrameData | null;    // datos del data channel
    connect: () => Promise<void>;
    disconnect: () => void;
};
```

- Establece RTCPeerConnection con el backend via POST /offer.
- Configura data channel para recibir JSON con conteo por frame.
- El backend ya envia video track; se agrega data channel.

### Hook useCounting

```typescript
type UseCountingReturn = {
    state: CountingState;
    startTime: Date | null;
    lastFrameCount: number;
    startCounting: (targetClass: string) => void;
    stopCounting: () => void;       // cambia a SAVING
    save: (camellon: string) => Promise<void>;
    discard: () => void;            // vuelve a IDLE
};
```

- startCounting: POST /api/sessions/start -> cambia a COUNTING
- stopCounting: POST /api/sessions/stop -> recibe total_count -> cambia a SAVING
- save: confirma guardado con camellon -> POST -> vuelve a IDLE
- discard: descarta -> vuelve a IDLE

### Flujo de estados

```
IDLE
  |-- usuario selecciona clase y presiona "Iniciar conteo"
  v
COUNTING
  |-- video muestra bboxes (dibujados por el backend en el frame)
  |-- overlay muestra conteo en frame (via data channel)
  |-- usuario presiona "Detener conteo"
  v
SAVING
  |-- modal con resultado del ultimo frame
  |-- usuario ingresa camellon y guarda  --> IDLE
  |-- usuario descarta                   --> IDLE
```

---

## Modulo Registro

### Componentes

**RegistryPage.tsx** - Pagina contenedora. Carga sesiones desde la API.
- Acepta query param `?camellon=X` para filtrado (viene desde modulo Mapa).

**SessionsTable.tsx** - shadcn `<Table>` con las sesiones de conteo.
- Columnas: Camellon, Fecha, Clase, Conteo.
- Click en fila -> muestra SessionDetail.
- Clases mostradas con `<Badge>`.

**SessionDetail.tsx** - shadcn `<Card>` con detalle de una sesion.
- CardHeader con titulo, CardContent con datos.
- Fecha/hora, clase, conteo, camellon.
- Placeholder para grafico temporal (futuro con conteo real).

**ExportButton.tsx** - shadcn `<Button variant="outline">` para descargar CSV.

### Datos

```
GET /api/sessions -> Session[]
GET /api/sessions/{id} -> Session (detalle)
GET /api/sessions/{id}/export -> CSV file download
```

---

## Modulo Mapa

### Componentes

**MapPage.tsx** - Pagina contenedora. Carga geo-summary y renderiza mapa + panel lateral.

**GoogleMap.tsx** - Wrapper de Google Maps.
- Inicializa el mapa con vista satelital centrada en coordenadas del campo.
- Renderiza marcadores por cada camellon con coordenadas.
- Soporta click en mapa para asignar ubicacion a camellon sin coordenadas.

**CamellonMarker.tsx** - Marcador en el mapa para un camellon.
- Color segun produccion:
  - Rojo: total_count < umbral_bajo
  - Amarillo: entre umbrales
  - Verde: total_count > umbral_alto
- Al hacer click abre InfoPanel.

**InfoPanel.tsx** - shadcn `<Card>` renderizado dentro de un InfoWindow de Google Maps.
- CardHeader con nombre camellon, CardContent con stats.
- shadcn `<Button variant="link">` "Ver sesiones" -> navega a /registro?camellon={id}

**UnlocatedList.tsx** - shadcn `<Card>` como panel lateral derecho.
- Lista de camellones sin lat/lng con `<Button variant="ghost">` cada uno.
- Al seleccionar uno, se activa modo "click en mapa para ubicar".
- Al hacer click en el mapa -> PUT /api/camellones/{id}/location

### Google Maps API

- Se carga dinamicamente con `@googlemaps/js-api-loader` o script tag.
- API key se obtiene de variable de entorno (VITE_GOOGLE_MAPS_API_KEY).
- Librerias: `maps`, `marker`, `visualization`.

### Datos

```
GET /api/camellones/geo-summary -> CamellonGeoSummary[]
GET /api/camellones -> Camellon[]
PUT /api/camellones/{id}/location -> {lat, lng}
POST /api/camellones -> {nombre, lat, lng}
```

---

## Navegacion

React Router con 3 rutas:

```
/           -> redirect a /vision
/vision     -> VisionPage
/registro   -> RegistryPage
/mapa       -> MapPage
```

**App.tsx** contiene:
- shadcn `<Tabs>` fijo arriba con 3 TabsTrigger: Vision, Registro, Mapa
- Cada tab usa `<Link>` de React Router para navegar
- Tab activa resaltada automaticamente por shadcn
- `<Outlet />` para renderizar la pagina del modulo activo

---

## Comunicacion con el backend

**api/client.ts** - Wrapper de fetch:
- Base URL configurable (en dev: `http://localhost:8080`)
- Manejo de errores comun

**api/sessions.ts:**
```typescript
getSessions(filters?): Promise<Session[]>
getSession(id): Promise<Session>
getSessionEvents(id): Promise<Event[]>
exportSession(id): void                     // descarga CSV
startSession(data): Promise<Session>
stopSession(): Promise<{total_count: number}>
```

**api/camellones.ts:**
```typescript
getCamellones(): Promise<Camellon[]>
createCamellon(data): Promise<Camellon>
updateLocation(id, lat, lng): Promise<void>
getGeoSummary(): Promise<CamellonGeoSummary[]>
```

---

## Estilo visual

- **shadcn/ui con tema oscuro** - se usa `class="dark"` en el HTML root
- Colores y variables CSS generadas por shadcn init (sin personalizacion manual)
- Base color: **zinc** (neutro, limpio)
- Fuente: system-ui (default de Tailwind)
- Video ocupa el mayor espacio posible en Vision
- Responsive basico: funcional en desktop y tablet
- Clases de Tailwind para layout (flex, grid, padding, etc.)
- No se escriben estilos CSS custom, todo via Tailwind + shadcn

---

## Implementacion paso a paso

### Paso 1: Scaffold del proyecto
- `npm create vite@latest` con template react-ts
- Instalar Tailwind CSS y configurar
- `npx shadcn@latest init` (tema oscuro, base color zinc)
- Instalar componentes shadcn: button, card, dialog, input, label, select, table, badge, tabs, separator, sonner
- Instalar react-router-dom
- Configurar vite proxy a localhost:8080 para /offer, /api/*

### Paso 2: Layout y navegacion
- App.tsx con shadcn Tabs + React Router
- 3 rutas con paginas placeholder
- Tema oscuro aplicado globalmente

### Paso 3: Vision - stream basico
- Migrar logica WebRTC del index.html actual al hook useWebRTC
- VideoStream.tsx renderizando el video
- Button shadcn conectar/desconectar

### Paso 4: Vision - conteo
- ClassSelector con shadcn Select
- Hook useCounting con estados IDLE/COUNTING/SAVING
- CountOverlay con Badge mostrando conteo en frame via data channel
- SaveDialog con shadcn Dialog + Input + Button

### Paso 5: Registro
- SessionsTable con shadcn Table + Badge
- SessionDetail con shadcn Card
- ExportButton con shadcn Button variant outline
- Filtrado por query param camellon

### Paso 6: Mapa
- Integrar Google Maps con @googlemaps/js-api-loader
- Marcadores con colores por produccion
- InfoPanel con shadcn Card dentro de InfoWindow
- UnlocatedList con shadcn Card + Button ghost

### Paso 7: Integracion
- Navegacion Mapa -> Registro (filtrado por camellon)
- Toast notifications con sonner para acciones
- Build de produccion y servir desde FastAPI
