# Roadmap

## Built so far

- El operador puede ver el stream en vivo desde el robot en cualquier navegador via WebRTC
- El sistema detecta objetos con YOLO en tiempo real y dibuja bounding boxes sobre el video
- El operador puede iniciar y detener sesiones de conteo por cruce de línea
- El operador puede grabar sesiones en MP4 con calidad HD nítida (NVENC en Jetson, libx264 en laptop dev)
- Los resultados de cada sesión quedan guardados y asociados a un camellón
- El admin puede subir, activar, editar y eliminar modelos de detección desde el servidor
- El AI engineer puede reemplazar el archivo `.pt` de un modelo sin eliminarlo y volverlo a subir
- El AI engineer puede asignar modelos específicos a cada robot desde el servidor
- Múltiples modelos pueden estar activos simultáneamente; cada uno se activa y desactiva de forma independiente
- El robot sincroniza automáticamente solo los modelos que le fueron asignados (hash mismatch detection)
- Los datos del robot se sincronizan automáticamente al servidor central cuando hay red
- El frontend de dispositivos muestra indicador online/offline basado en el último sync
- El admin puede rotar el API key de un dispositivo desde el panel; la clave solo es visible una vez
- El operador selecciona el tipo de objeto desde un picker de cards en dos pasos (objeto → operación)
- Los investigadores pueden consultar el historial de sesiones y el dashboard de producción
- El acceso está protegido por roles (admin / operador) con login JWT
- Robot y servidor se despliegan como servicios systemd con un solo comando

---

## Phase 1: UX Vision (Complete)

**Goal:** cualquier operador sin conocimiento técnico puede usar el robot sin ayuda.

- [x] Pantalla Vision muestra bloques de selección de objeto antes del stream
- [x] El operador elige el tipo de objeto y avanza a la pantalla de operación
- [x] Desde la pantalla de operación puede volver a cambiar el objeto seleccionado
- [x] El stream y los botones de acción aparecen solo después de seleccionar el objeto

---

## Phase 2: Estabilidad de cámara WebRTC (Complete)

**Goal:** el robot no requiere reinicio manual ante fallos de cámara.

- [x] Si la cámara se desconecta físicamente, la peer connection WebRTC se cierra limpiamente
- [x] El frontend detecta el cierre y sale del estado "cargando" con un mensaje de error
- [x] Si la cámara cae durante una sesión, la sesión se cierra y se puede iniciar una nueva sin reiniciar

---

## Phase 3: Servicio de cámara independiente (Complete)

**Goal:** la captura V4L2 corre en un proceso separado para que los fallos de cámara no afecten el event loop de FastAPI.

- [x] `camera-worker` es un proceso independiente que captura frames y los sirve por Unix socket (frames raw, protocolo length-prefixed)
- [x] `CameraStreamTrack` lee frames del socket en vez de acceder a V4L2 directamente
- [x] Si el worker se cae o la cámara se desconecta, el worker se reinicia solo y el backend reconecta sin intervención
- [x] El servicio se instala como unidad systemd separada junto al robot

---

## Phase 4: Verificación del conteo con pesos estándar (Complete)

**Goal:** verificar que el conteo en tiempo real funciona correctamente en el laboratorio antes del día de campo.

- [x] El operador puede seleccionar y activar pesos estándar de YOLO (personas) desde el frontend
- [x] El conteo por cruce de línea funciona correctamente con personas en condiciones de laboratorio
- [x] El sistema permite cambiar el modelo activo sin reiniciar el robot

---

## Phase 5: Contexto del robot — fundo + ubicación (Complete)

**Goal:** el admin define a qué empresa/fundo pertenece cada robot; el operador trabaja dentro de ese contexto creando camellones y ubicaciones sin volver a pantallas administrativas y sin ver datos de otros fundos.

**Solo admin (vista de servidor):**

- [x] El admin puede asociar un robot a un fundo desde `DevicesPage` (campo `fundo_uuid` en Device)
- [x] La asociación es la única forma de cambiar empresa/fundo de un robot — no editable desde el robot

**Solo operador (vista del robot):**

- [x] El robot muestra empresa y fundo asignados como info de contexto (read-only); no muestra otros fundos
- [x] El operador puede crear una ubicación nueva desde el `SaveDialog` al final de una sesión (sin volver a otra pantalla)
- [x] Alternativamente, el operador puede guardar la sesión sin ubicación y asignarla después desde `MapPage` (`UnlocatedList`)
- [x] El operador puede crear y editar camellones desde el robot (nombre/código), siempre dentro del fundo asignado

---

## Phase 6: Grabación de video (Complete)

**Goal:** el robot puede grabar sesiones en video como fallback al conteo en tiempo real.

- [x] El operador puede iniciar y detener grabación desde el frontend
- [x] El stream se guarda como MP4 en el robot durante la sesión
- [x] Los videos grabados son descargables o sincronizables al servidor

---

## Phase 7: Configurabilidad del recording-worker (calidad/CPU/disco) (In Progress)

**Goal:** los parámetros de encoding son ajustables por env sin tocar código, para que dev en laptop (libx264, CPU caro) pueda bajar carga y producción en Jetson (NVENC, ~no-CPU) mantenga calidad alta.

- [ ] El bitrate del recording-worker se controla por env var (`RECORDING_BITRATE_BPS`); default 8 Mbps NVENC / 6 Mbps libx264
- [ ] El preset de libx264 (laptop dev) se controla por env (`RECORDING_X264_PRESET`); default `medium`, sin afectar el path NVENC de Jetson
- [x] El framerate efectivo se respeta del handshake del camera-worker en vez del 30 hardcodeado actual
- [ ] Documentado en `recording_worker/README.md` qué env vars existen y cuál es el default por backend

---

## Phase 8: Calidad HD de la grabación (Complete)

**Goal:** el video grabado se ve nítido y aprovecha la cámara para revisión posterior, sin perder fluidez ni saturar disco.

- [x] El recording-worker graba a 1280x720 con captura YUYV (sin re-encoding MJPEG intermedio)
- [x] Bitrate y parámetros de NVENC afinados para HD nítido manteniendo el tamaño de archivo razonable (8 Mbps CBR, profile=High, preset=Slow)
- [x] La nitidez del MP4 grabado coincide visualmente con el stream en vivo
- [x] Documentado el preset elegido y por qué (tradeoff calidad / disco / CPU) en `recording_worker/README.md`

---

## Phase 9: Resolución mayor en grabación

**Goal:** el operador puede revisar grabaciones con más detalle del que cabe en 720p, aprovechando lo que el sensor de la cámara realmente captura.

- [ ] El video grabado supera la resolución actual (1280x720) sin degradar fluidez ni saturar disco
- [ ] Detalles finos (textura de hojas, bordes de fruta, letras pequeñas) se ven en la revisión posterior con claridad mayor que en 720p
- [ ] La transmisión en vivo no sufre regresión perceptible de FPS o latencia mientras se graba a la nueva resolución
- [ ] Documentado en `recording_worker/README.md` el techo de resolución viable con el hardware actual y el por qué del trade-off elegido (un ojo / estéreo, live downscale o no)

---

## Phase 10: Nuevo método de conteo

**Goal:** el conteo es más robusto y no depende exclusivamente del tracker de YOLO.

- [ ] El operador puede elegir entre el método de cruce de línea y el método por similitud entre frames
- [ ] El método por similitud está integrado al pipeline del worker
- [ ] Ambos métodos producen el mismo formato de resultado

---

## Phase 11: Deploy servidor + validación end-to-end

**Goal:** el flujo completo robot → servidor funciona en producción y el operador siempre sabe qué modelo está activo.

- [ ] El servidor central está instalado en la PC del laboratorio con PostgreSQL
- [ ] El robot muestra claramente qué modelo y qué etiquetas tiene disponibles
- [ ] La sincronización robot → servidor es verificable sin intervención técnica

---

## Phase 12: Integración de otros objetos

**Goal:** el sistema soporta distintos tipos de fruta u objeto sin cambios de código.

- [ ] El AI engineer registra un nuevo modelo con su class_mapping desde el servidor
- [ ] El robot sincroniza las etiquetas disponibles del nuevo modelo automáticamente
- [ ] El operador ve los nuevos objetos en la pantalla de selección sin ninguna intervención técnica

---

## Pendiente (sin fecha)

- Clasificación offline de frutos (crops por track_id + modelo de calidad/madurez)
- Mapa offline (tiles descargados al robot para campo sin internet)
- Cámara por red WiFi (en vez de USB)
- Evaluación y finetuning del modelo YOLO para detección
