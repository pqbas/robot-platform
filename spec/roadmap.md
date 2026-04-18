# Roadmap

## Built so far

- El operador puede ver el stream en vivo desde el robot en cualquier navegador via WebRTC
- El sistema detecta objetos con YOLO en tiempo real y dibuja bounding boxes sobre el video
- El operador puede iniciar y detener sesiones de conteo por cruce de línea
- Los resultados de cada sesión quedan guardados y asociados a un camellón
- El admin puede subir, activar y eliminar modelos de detección desde el servidor
- Los datos del robot se sincronizan automáticamente al servidor central cuando hay red
- Los investigadores pueden consultar el historial de sesiones y el dashboard de producción
- El acceso está protegido por roles (admin / operador) con login JWT
- Robot y servidor se despliegan como servicios systemd con un solo comando

---

## Phase 1: UX Vision (In Progress)

**Goal:** cualquier operador sin conocimiento técnico puede usar el robot sin ayuda.

- [ ] Pantalla Vision muestra bloques de selección de objeto antes del stream
- [ ] El operador elige el tipo de objeto y avanza a la pantalla de operación
- [ ] Desde la pantalla de operación puede volver a cambiar el objeto seleccionado
- [ ] El stream y los botones de acción aparecen solo después de seleccionar el objeto

---

## Phase 2: Grabación de video y corrección de bugs

**Goal:** el robot graba sesiones en video y no requiere reinicio manual ante fallos de cámara.

- [ ] El operador puede elegir entre modo conteo y modo grabación
- [ ] En modo grabación el stream se guarda como MP4
- [ ] Si la cámara se desconecta físicamente, el recurso se libera automáticamente
- [ ] Si la cámara cae durante una sesión, la sesión se cierra y se puede iniciar una nueva sin reiniciar

---

## Phase 3: Nuevo método de conteo

**Goal:** el conteo es más robusto y no depende exclusivamente del tracker de YOLO.

- [ ] El operador puede elegir entre el método de cruce de línea y el método por similitud entre frames
- [ ] El método por similitud está integrado al pipeline del worker
- [ ] Ambos métodos producen el mismo formato de resultado

---

## Phase 4: Deploy servidor + validación end-to-end

**Goal:** el flujo completo robot → servidor funciona en producción y el operador siempre sabe qué modelo está activo.

- [ ] El servidor central está instalado en la PC del laboratorio con PostgreSQL
- [ ] El AI engineer puede asignar modelos a robots desde el servidor
- [ ] El robot muestra claramente qué modelo y qué etiquetas tiene disponibles
- [ ] El operador selecciona el tipo de objeto desde las etiquetas del modelo asignado
- [ ] La sincronización robot → servidor es verificable sin intervención técnica

---

## Phase 5: Integración de otros objetos

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
