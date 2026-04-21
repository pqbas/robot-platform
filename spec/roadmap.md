# Roadmap

## Built so far

- El operador puede ver el stream en vivo desde el robot en cualquier navegador via WebRTC
- El sistema detecta objetos con YOLO en tiempo real y dibuja bounding boxes sobre el video
- El operador puede iniciar y detener sesiones de conteo por cruce de línea
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

## Phase 2: Estabilidad de cámara WebRTC (In Progress)

**Goal:** el robot no requiere reinicio manual ante fallos de cámara.

- [ ] Si la cámara se desconecta físicamente, la peer connection WebRTC se cierra limpiamente
- [ ] El frontend detecta el cierre y sale del estado "cargando" con un mensaje de error
- [ ] Si la cámara cae durante una sesión, la sesión se cierra y se puede iniciar una nueva sin reiniciar

---

## Phase 3: Servicio de cámara independiente

**Goal:** la captura V4L2 corre en un proceso separado para que los fallos de cámara no afecten el event loop de FastAPI.

- [ ] `camera-worker` es un proceso independiente que captura frames y los sirve por Unix socket (frames raw, protocolo length-prefixed)
- [ ] `CameraStreamTrack` lee frames del socket en vez de acceder a V4L2 directamente
- [ ] Si el worker se cae o la cámara se desconecta, el worker se reinicia solo y el backend reconecta sin intervención
- [ ] El servicio se instala como unidad systemd separada junto al robot

---

## Phase 4: Grabación de video

**Goal:** el robot puede grabar sesiones en video además de contar.

- [ ] El operador puede elegir entre modo conteo y modo grabación
- [ ] En modo grabación el stream se guarda como MP4

---

## Phase 5: Nuevo método de conteo

**Goal:** el conteo es más robusto y no depende exclusivamente del tracker de YOLO.

- [ ] El operador puede elegir entre el método de cruce de línea y el método por similitud entre frames
- [ ] El método por similitud está integrado al pipeline del worker
- [ ] Ambos métodos producen el mismo formato de resultado

---

## Phase 6: Deploy servidor + validación end-to-end

**Goal:** el flujo completo robot → servidor funciona en producción y el operador siempre sabe qué modelo está activo.

- [ ] El servidor central está instalado en la PC del laboratorio con PostgreSQL
- [ ] El robot muestra claramente qué modelo y qué etiquetas tiene disponibles
- [ ] La sincronización robot → servidor es verificable sin intervención técnica

---

## Phase 7: Integración de otros objetos

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
