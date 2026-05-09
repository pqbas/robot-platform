# Roadmap

## Built so far

- El operador puede ver el stream en vivo desde el robot en cualquier navegador via WebRTC
- El sistema detecta objetos con YOLO en tiempo real y dibuja bounding boxes sobre el video
- El operador puede iniciar y detener sesiones de conteo por cruce de línea
- El operador puede grabar sesiones en MP4 a 1080p o 720p (NVENC en Jetson, libx264 en laptop dev) con bitrate auto-escalado por altura del frame
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

## Phase 7: Calidad HD de la grabación (Complete)

**Goal:** el video grabado se ve nítido y aprovecha la cámara para revisión posterior, sin perder fluidez ni saturar disco.

- [x] El recording-worker graba a 1280x720 con captura YUYV (sin re-encoding MJPEG intermedio)
- [x] Bitrate y parámetros de NVENC afinados para HD nítido manteniendo el tamaño de archivo razonable (8 Mbps CBR, profile=High, preset=Slow)
- [x] La nitidez del MP4 grabado coincide visualmente con el stream en vivo
- [x] Documentado el preset elegido y por qué (tradeoff calidad / disco / CPU) en `recording_worker/README.md`

---

## Phase 8: Resolución mayor en grabación (Complete)

**Goal:** el operador puede revisar grabaciones con más detalle del que cabe en 720p, aprovechando lo que el sensor de la cámara realmente captura.

- [x] El video grabado supera la resolución actual (1280x720) sin saturar disco — default 1920×1080 nativo del estéreo SBS de la ZED 2i, bitrate auto-escalado (12 Mbps NVENC ≥1080p, 8 Mbps a 720p)
- [x] Detalles finos (textura de hojas, bordes de fruta, letras pequeñas) se ven en la revisión posterior con claridad mayor que en 720p
- [x] La transmisión en vivo no sufre regresión perceptible de FPS o latencia mientras se graba a la nueva resolución — resuelto en Phase 9 al portar el live a H.264 NVENC con bridge NVMM y `maxperf-enable=true` (medido 25 fps a 1080p en `about:webrtc`)
- [x] Documentado en `recording_worker/README.md` y `camera_worker/README.md` los dos modos (1080p default, 720p alternativo)

---

## Phase 9: WebRTC live a H.264 NVENC sin caveat (Complete)

**Goal:** eliminar el caveat de Phase 8 — el live WebRTC sostiene 1080p @ 30fps en Jetson sin obligar al operador a volver a 720p. Portar al path WebRTC la fix NVMM y los presets de calidad ya validados en el `recording_worker`.

- [x] Agregar bridge NVMM (`nvvidconv ! video/x-raw(memory:NVMM)`) al pipeline de `GstNvencEncoder` en `back/services/nvenc_codec.py`
- [x] Subir `profile` a `High` y `preset-level` a `Slow` (4) en `GstNvencEncoder`, paridad con `recording_worker` post-Phase 7
- [x] Logging explícito en `init_nvenc` y al primer frame de cada peer connection: qué codec negoció realmente (H264 vs VP8) y qué backend usa el encoder
- [x] Validar en Jetson + ZED 2i con `about:webrtc`: codec negociado = `H264`, `framesPerSecond ≥ 25` a 1920×1080, `packetsLost = 0` — medido 25 fps tras agregar `maxperf-enable=true` al encoder
- [x] Quitar de `camera_worker/README.md` y `recording_worker/README.md` la recomendación de override 720p en `.env.robot`; el default 1080p deja de degradar el live
- [x] Marcar Phase 8 como `(Complete)` (todas las cajas) una vez confirmado que el live sostiene 1080p

---

## Phase 10: Selector de resolución desde el frontend (Complete)

**Goal:** el operador puede bajar la calidad del live cuando la red entre Jetson y operador está débil, sin entrar al robot ni reiniciar servicios.

- [x] El operador elige la resolución de captura (1080p / 720p) desde un control en la pantalla Vision
- [x] El cambio se aplica sin reiniciar servicios systemd; el live se renegocia automáticamente
- [x] La grabación toma siempre la misma resolución que el live (un solo modo activo por robot)
- [x] La elección persiste entre sesiones (sobrevive al reinicio del robot)

---

## Phase 11: Inferencia YOLO con TensorRT (Complete)

**Goal:** la inferencia corre más rápido en Jetson para modelos seleccionados, dejando margen de cómputo para sostener live + recording + detección sin regresiones.

- [x] Cada modelo asignado al robot tiene un toggle TensorRT / PyTorch en el frontend
- [x] Al activar TensorRT en un modelo, el robot convierte el `.pt` a `.engine` localmente (la optimización es device-specific y debe ocurrir en el Jetson)
- [x] El inference-worker usa el `.engine` cuando el modelo está en modo TensorRT y el `.pt` cuando está en modo PyTorch
- [x] Modelos library (e.g. `yolo11n.pt`) también pueden convertirse — el toggle aplica a cualquier modelo asignado, no solo a los uploaded
- [ ] Documentado el tradeoff (tiempo de conversión, ganancia de FPS observada en Jetson) y cómo revertir un modelo a PyTorch — diferido a Phase 16 (`spec/29-04-26-inference-perf/`)

Shipped en PR #TBD.

---

## Phase 12: Configurabilidad del recording-worker (calidad/CPU/disco)

**Goal:** los parámetros de encoding son ajustables por env sin tocar código, para que dev en laptop (libx264, CPU caro) pueda bajar carga y producción en Jetson (NVENC, ~no-CPU) mantenga calidad alta.

- [ ] El bitrate del recording-worker se controla por env var (`RECORDING_BITRATE_BPS`); cuando la env var no está definida, mantener el auto-scale actual (12 Mbps NVENC ≥1080p, 8 Mbps a 720p; 9/6 Mbps libx264) para no degradar la calidad del robot en producción
- [ ] El preset de libx264 (laptop dev) se controla por env (`RECORDING_X264_PRESET`); default `medium`, sin afectar el path NVENC de Jetson
- [x] El framerate efectivo se respeta del handshake del camera-worker en vez del 30 hardcodeado actual
- [ ] Documentado en `recording_worker/README.md` qué env vars existen y cuál es el default por backend

---

## Phase 13: Deploy servidor + validación end-to-end

**Goal:** el flujo completo robot → servidor funciona en producción y el operador siempre sabe qué modelo está activo.

- [ ] El servidor central está instalado en la PC del laboratorio con PostgreSQL
- [ ] El robot muestra claramente qué modelo y qué etiquetas tiene disponibles
- [ ] La sincronización robot → servidor es verificable sin intervención técnica

---

## Phase 14: Integración de otros objetos

**Goal:** el sistema soporta distintos tipos de fruta u objeto sin cambios de código.

- [ ] El AI engineer registra un nuevo modelo con su class_mapping desde el servidor
- [ ] El robot sincroniza las etiquetas disponibles del nuevo modelo automáticamente
- [ ] El operador ve los nuevos objetos en la pantalla de selección sin ninguna intervención técnica

---

## Phase 15: Nuevo método de conteo

**Goal:** el conteo es más robusto y no depende exclusivamente del tracker de YOLO.

- [ ] El operador puede elegir entre el método de cruce de línea y el método por similitud entre frames
- [ ] El método por similitud está integrado al pipeline del worker
- [ ] Ambos métodos producen el mismo formato de resultado

---

## Phase 16: Optimización de latencia de inferencia

**Goal:** la inferencia (modelo + tracker + framework) corre lo suficientemente rápido para que el conteo no pierda detecciones a la velocidad real del robot, y para que TensorRT entregue el speedup esperado sobre PyTorch (no solo 1.3× como muestra la primera medición).

**Contexto:** Phase 11 entrega el path TensorRT funcional, pero medir la latencia mostró un problema no anticipado: la inferencia total en `model.track()` es ~52 ms (TRT) y ~75 ms (PT), con solo 1.3× de speedup end-to-end. La inferencia del modelo en sí es más rápida con TRT (16 ms vs 28 ms, 1.75×), pero ~50% del tiempo total es overhead del wrapper de ultralytics. Detalle completo en `spec/29-04-26-inference-perf/current-state.md`.

- [x] Instrumentar el `inference-worker` con timings por etapa (preprocess / inference / postprocess) y un agregador rolling con `make bench-inference` para snapshots on-demand
- [ ] Pinear clocks de Jetson al máximo en boot (systemd unit `jetson-clocks.service`); hoy se aplica manualmente con `sudo jetson_clocks` y se pierde en reboot
- [ ] Identificar cuál es el overhead de ~27 ms dentro de `model.track()` que no aparece en las stages de ultralytics (Predictor setup per-call, ByteTrack association, Result construction)
- [ ] Reemplazar `model.track()` por un path más bajo (`model.predict(stream=True)` + ByteTrack persistente, o llamar directo al `predictor.inference()`)
- [ ] Validar que la inferencia pura del engine baja a ~6–8 ms (lo esperado para YOLO11n FP16 en Xavier AGX) y no los 16 ms actuales
- [ ] Documentar el tradeoff y la metodología en un writeup que incluya tabla PT vs TRT FP16 (latency p50/p99, FPS, mAP), trace de profiling, y los pasos aplicados — entregable que también sirve de portafolio de inference engineering

---

## Phase 17: Informe técnico unificado #4 a PROCIENCIA (Complete)

**Goal:** consolidar los entregables previos a PROCIENCIA (#2 IA, #3 Plataforma) y el avance interno actual en un único informe formal #4 que cubra plataforma + IA en un solo documento.

- [x] Reestructurar `26_05_05_informe_4_unificado.md` con el formato PROCIENCIA (portada institucional, Resumen, I. Introducción, II. Objetivo general, III. Metodología, IV. Materiales, V. Resultados, VI. Conclusiones, VII. Referencias)
- [x] Insertar capítulo de IA en versión resumen: modelos evaluados (YoloV9/V10/V11), métricas obtenidas por modelo (mAP, F1, precisión, recall) y elección final, sin la teoría de arquitecturas del informe #2
- [x] Conservar el contenido vigente de plataforma del avance v2 (workers, TensorRT, fan-out, despliegue) integrado al nuevo TOC
- [x] Compilar a `.docx` con `node docs/informes/generate.js 26_05_05_informe_4_unificado.md`

Shipped en PR #51 (merge `2a5e664`).

---

## Phase 18: Acceso público al server con auth (Complete)

**Goal:** el server del laboratorio queda accesible desde internet con una URL estable, pero solo entrega datos sensibles a usuarios con JWT válido.

- [x] El server expone una URL pública estable (`https://<host>.ts.net` vía Tailscale Funnel) que sobrevive reinicios
- [x] Todas las rutas server-mode requieren auth excepto `POST /api/auth/login` y `/health` de sync
- [x] `/api/dashboard/stats` queda protegido con `Depends(get_current_user)`
- [x] Eliminado el seed `admin/admin`; el primer admin se crea con `make create-admin` (interactivo, password por stdin)
- [x] Si no hay credenciales de bootstrap, el server arranca sin usuarios y loguea warning (no fallback inseguro)
- [ ] Validado desde red externa (4G): la URL carga login, sin token devuelve 401, con login válido el dashboard carga

Spec en `spec/06-05-26-acceso-publico-server-auth/`. Validación end-to-end: `/api/sync/health` 200 y `/api/dashboard/stats` 401 confirmados desde la URL pública. La validación con frontend (login en navegador) queda diferida a la fase de exponer el frontend, ya que esta fase entregó solo backend + nginx-template.

Shipped en PR #53.

---

## Phase 19: Frontend público vía server mode

**Goal:** la URL pública del server entrega el frontend React además de la API, sin necesidad de nginx, completando el flujo end-to-end de Phase 18.

- [ ] El usuario abre `https://<host>.ts.net/` desde cualquier red y ve la pantalla de login del frontend
- [ ] El SPA routing funciona desde el navegador externo (rutas client-side como `/login`, `/dashboard` no devuelven 404 al recargar)
- [ ] El proceso de levantar el server en modo `SERVER` compila el frontend automáticamente o falla con mensaje claro si falta el build
- [ ] El operador puede hacer login desde el navegador externo y el dashboard carga datos reales
- [ ] La separación robot/server no se rompe: en modo `ROBOT` el frontend sigue sirviéndose por Vite dev server o nginx existente, sin cambios de UX para el operador del robot

---

## Pendiente (sin fecha)

- Clasificación offline de frutos (crops por track_id + modelo de calidad/madurez)
- Mapa offline (tiles descargados al robot para campo sin internet)
- Cámara por red WiFi (en vez de USB)
- Evaluación y finetuning del modelo YOLO para detección
