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

## Phase 19: Frontend público vía server mode (Complete)

**Goal:** la URL pública del server entrega el frontend React además de la API, sin necesidad de nginx, completando el flujo end-to-end de Phase 18.

- [x] El usuario abre `https://<host>.ts.net/` desde cualquier red y ve la pantalla de login del frontend
- [x] El SPA routing funciona desde el navegador externo (rutas client-side como `/login`, `/dashboard` no devuelven 404 al recargar)
- [x] El proceso de levantar el server en modo `SERVER` compila el frontend automáticamente o falla con mensaje claro si falta el build
- [x] El operador puede hacer login desde el navegador externo y el dashboard carga datos reales
- [x] La separación robot/server no se rompe: en modo `ROBOT` el frontend sigue sirviéndose por Vite dev server o nginx existente, sin cambios de UX para el operador del robot

Spec en `spec/09-05-26-frontend-publico-server/`. Hardening adicional durante la implementación: whitelist estricta de rutas SPA (cualquier path no-SPA y no-archivo devuelve 404 en vez de index.html), `/docs`/`/redoc`/`/openapi.json` deshabilitados en modo SERVER, y rotación de la VITE_GOOGLE_MAPS_API_KEY que estaba expuesta en el bundle público.

Shipped en PR #54.

---

## Phase 20: Hardening del server público (Complete)

**Goal:** el server público resiste ataques realistas (brute force de login, abuso CORS, MITM, embedding malicioso) más allá del filtrado pasivo de scanners ya implementado en Phase 18/19.

- [x] `/api/auth/login` aplica rate limiting por IP (devuelve 429 al exceder el límite definido en la fase)
- [x] La cuenta de un usuario se bloquea temporalmente tras varios logins fallidos consecutivos, mostrando mensaje claro al operador
- [x] CORS en modo SERVER restringe `allow_origins` a la URL pública del frontend en lugar de `["*"]`
- [x] El server emite security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) en todas las respuestas

Spec en `spec/09-05-26-server-hardening/`. Shipped en PR #TBD.

---

## Phase 22: Cobertura de auth en server mode (Complete)

**Goal:** ninguna ruta `/api/*` en server mode queda accesible desde internet sin autenticación, cerrando el gap descubierto durante Phase 20 (rutas como `/api/locations`, `/api/sessions`, `/api/recordings/` están abiertas hoy).

- [x] Toda ruta `/api/*` en modo SERVER requiere JWT válido excepto la whitelist explícita (`/api/auth/login`, `/api/sync/health`, sync con device API key)
- [x] Auditoría completa de rutas con tabla de cobertura
- [x] Modo ROBOT no se rompe (las rutas siguen abiertas en red local)
- [x] El frontend público sigue funcionando end-to-end con login

Shipped en PR #TBD.

---

## Phase 23: Hardening adicional del server público

**Goal:** cerrar gaps remanentes de seguridad detectados después de Phase 22 — superficie de auth aún más chica, defensa en profundidad y trazabilidad de accesos.

- [ ] Auditoría persistente de logins (tabla `login_attempts` con timestamp, IP, username, success/fail) y endpoint admin para listarlos
- [ ] Rate limit persistente (Redis o tabla en DB) para que el contador sobreviva reinicios del proceso
- [ ] Verificar permisos `600` de `.env.server` y documentar rotación del `JWT_SECRET` en `deploy/README.md`
- [ ] Quitar `/api/sync/health` de la whitelist si no lo consume monitoring externo (o autenticarlo con device API key)
- [ ] Hardcodear `mode: "server"` en builds de frontend server-mode para eliminar el round-trip a `/api/config/setup-status` y poder quitarlo de la whitelist
- [ ] Forzar contraseña fuerte al crear/editar usuarios en `/admin/users` (validador en backend, no solo frontend)
- [ ] Revisión periódica documentada del prefijo `/api/sync/*` para asegurar que toda ruta nueva ahí lleva `_device_dep`

---

## Phase 24: Resiliencia del streaming WebRTC

**Goal:** el operador en el celular ve el stream durante una sesión completa sin tener que ir a `/settings → guardar` para reanimar el video. Recovery automático ante hipos de WiFi, freezes con data channel vivo, y arranque tardío del camera-worker.

- [ ] Frontend detecta freeze mid-sesión (`framesDecoded` plano por 3s aunque el peer siga `connected`) y dispara nuevo offer con backoff
- [ ] Frontend detecta `connectionState === "failed"` / `iceConnectionState` disconnected sostenido y reconecta con el mismo backoff
- [ ] Backend espera a que `/tmp/camera.sock` esté listo antes de aceptar el offer (responde 503 si no lo está)
- [ ] `CameraClient.read_frame` reintenta con backoff hasta 5 s antes de matar la track (en vez del retry de un disparo actual)
- [ ] Investigar y forzar keyframes a intervalo razonable o responder PLI/FIR para sobrevivir packet loss en WiFi
- [ ] UI muestra estado "Reconectando…" durante backoff y "Stream caído, reintentar" después de agotar 4 intentos

---

## Phase 21: Conectar robot al server público (Complete)

**Goal:** el robot móvil sincroniza datos al server público vía la URL de Tailscale Funnel, validando el flow end-to-end de Phase 18/19.

- [x] El admin crea un device desde `/admin/devices` y obtiene una API key visible una sola vez
- [x] El operador configura el robot apuntando al server público desde la pantalla `/setup` (sin SSH al Jetson)
- [x] El robot pushea sessions, counting events, recordings y locations al server y recibe confirmación
- [x] El admin ve los datos del robot en el dashboard del server desde fuera del laboratorio
- [x] Procedimiento documentado para que un operador nuevo pueda configurar un robot de cero sin ayuda

Shipped en PR #TBD.

---

## Phase 25: Streaming MJPEG + WebSocket (dual-mode con feature flag) (Complete)

**Goal:** ofrecer un transport de video alternativo a WebRTC, más simple y robusto en LAN/WiFi flaky, sin remover el path actual. WebRTC sigue siendo válido para uso futuro (NAT traversal, multi-viewer SFU, audio). El nuevo path es la opción default para el caso real actual (operador en localhost o LAN).

**Contexto:** WebRTC arrastra estado de codec H264 + RTP secuenciado; en WiFi 5GHz débil con packet loss intermitente, una pérdida congela el video hasta el próximo keyframe (o reconexión completa). MJPEG sobre WebSocket es "latest-frame-wins": cada frame independiente, sin estado de codec que corromper, naturalmente multi-cliente con fan-out. Trade-off: ~2-5× más bitrate vs H264. Aceptable en LAN.

- [ ] Backend: `back/services/stream_broadcaster.py` lee BGR del camera-socket, encodea JPEG una sola vez por frame, fan-out a N clientes WS con cola `drop-oldest` por cliente (mismo patrón que camera-worker)
- [ ] Backend: `back/routes/stream_ws.py` expone `/ws/stream`, mensaje binario por frame con length-prefixed JSON header (`frame_id`, `detections`, `session_active`, `session_total`) + JPEG bytes
- [ ] Backend: encoder JPEG software (`cv2.imencode`) como inicio; migrar a GStreamer `nvjpegenc` si la CPU del Jetson sufre a 1080p30
- [ ] Frontend: `front/src/hooks/useMjpegStream.ts` parsea el WS, emite `frameBlob` + `detections` con la misma superficie que `useWebRTC` para no tocar `VisionPage.tsx`
- [ ] Frontend: `front/src/hooks/useStream.ts` selecciona entre `useWebRTC` y `useMjpegStream` según `localStorage.stream.mode` (default `webrtc` para no romper nada)
- [ ] Frontend: `VideoStream.tsx` soporta tanto `<video ref>` como `<canvas>` (canvas para MJPEG permite pintar boxes encima sin overlay DOM)
- [ ] Validar en 5GHz WiFi flaky: MJPEG mantiene 25+ fps visible con pérdida del 5% donde WebRTC freeza
- [ ] Validar multi-cliente: 2 navegadores conectados a `/ws/stream` simultáneo ven el mismo video y boxes, sin desconectarse entre sí (a diferencia de `/offer` actual que cierra previas)
- [ ] Documentar el toggle en `CLAUDE.md` (sección Stream / WebRTC)
- [ ] Después de uso real en campo: si MJPEG resulta más robusto, flippear default. WebRTC queda como fallback para futuros casos NAT traversal / SFU.

---

## Phase 26: UX móvil — acceso a Configuración y auditoría de pantallas clave

**Goal:** que el operador opere el robot desde su celular sin tener que ir a un escritorio para entrar a `/settings` o sincronizar.

- [ ] Bottom-nav móvil del robot incluye Configuración como item visible (hoy vive solo en el footer del sidebar desktop)
- [ ] "Sincronizar" accesible desde móvil vía card en `/settings` (no inflar el bottom-nav)
- [ ] Auditoría visual de `/vision`, `/recordings`, `/settings`, `/dashboard`, `/mapa` en viewport ≤ 480px: arreglar layouts rotos (action bar de Vision, tabla de Recordings)
- [ ] Cero regresión desktop: todos los cambios via media queries Tailwind

Ver `spec/11-05-26-mobile-ux-acceso/`.

---

## Phase 27: MJPEG performance — bajar latencia en mobile

**Goal:** acercar el FPS del path MJPEG en celular al de WebRTC (~25-30 fps vs ~10 actual), sin perder la robustez ganada en la fase 25.

**Contexto:** la fase 25 dejó el MJPEG funcional y estable (sin freezes, sin desconexiones), pero en celular el decode JPEG corre en software JS y cuesta ~100 ms por frame a 720p q=80. WebRTC vuela porque tiene H264 con decode por hardware. La fase ataca dos frentes: (a) reducir el peso del frame que llega al cliente, (b) ocultar el RTT del ACK con pipeline depth > 1, y (c) opcionalmente partir en perfiles hi/lo para que desktop conserve calidad y mobile tenga FPS.

- [ ] Backend: `JPEG_QUALITY` configurable vía env (default 60-65 en lugar de 80)
- [ ] Backend: pipeline depth configurable en `stream_ws.py` (default 2, ocultar RTT)
- [ ] Backend (opcional): perfiles hi/lo con resolución reducida (854x480 o 640x360) para mobile, encode por perfil activo, fan-out a clientes suscriptos
- [ ] Frontend: cliente elige perfil vía query string (`?profile=lo|hi`), auto-detecta mobile
- [ ] Frontend (opcional): throttle de `setFrameData` a 15 Hz si el re-render de overlays domina
- [ ] Validar: ≥ 20 fps sostenido en mobile tras 5 min de stream, sin OOM
- [ ] Validar: desktop no regresa (≥ 28 fps, calidad visual aceptable)
- [ ] Validar: counting/detection sigue precisa (no perder boxes por throttle ni por compresión)

Ver `spec/12-05-26-mjpeg-perf/` (a planificar con `/spec-phase`).

---

## Phase 28: Stream H264 vía WebCodecs sobre WebSocket — HW decode con control de drop (Complete)

**Goal:** transport de video que use el decoder hardware H264 del cliente (mismo silicio que decodifica Netflix/YouTube), sin las desconexiones y freezes que arrastra WebRTC. Apunta a 25-30 fps reales en celular, latencia ≤ 500 ms, con descarte explícito de frames cuando el render se atrasa.

**Contexto:** MJPEG (fase 25) ganó robustez pero el decode JPEG en software JS tope a ~10 fps en mobile (la fase 27 lo lleva a ~15-20 a costa de calidad). WebRTC tiene HW decode pero arrastra codec stateful + ICE + RTP retransmission — frágil ante packet loss en WiFi débil. La WebCodecs API (`VideoDecoder`) da acceso directo al decoder hardware del SoC vía MediaCodec — sin muxer, sin SDP, sin buffering del browser. El servidor manda NAL units H264 Annex-B crudos por WS y el cliente los pasa al `VideoDecoder` con control total sobre qué chunks dropear. Trade-off: latencia ~100-300 ms vs <100 ms de WebRTC; pivote desde MSE (evaluado y descartado por buffer interno de 500ms-2s en el browser, que no cumplía el target de latencia).

Mobile target acordado: Android moderno (Chrome / Edge / Samsung Internet, todos Chromium con WebCodecs maduro desde 2022). Firefox Android tiene soporte parcial — fuera de scope. iOS Safari ≥ 17 existe pero buggy — fuera de scope.

- [ ] Backend: encoder H264 Annex-B reusando `back/services/nvenc_codec.py` — pipeline GStreamer Jetson termina en `h264parse config-interval=1 ! appsink` (sin muxer, SPS/PPS inband por keyframe).
- [ ] Backend: `back/services/wc_broadcaster.py` análogo a `stream_broadcaster.py` — un encoder, fan-out a N clientes WS, per-cliente queue drop-oldest, lifecycle lazy.
- [ ] Backend: `/ws/wc-stream` envía cada frame como `[uint32 BE header_len][JSON header][H264 NAL bytes]`. Header bundle-ea detections + `is_keyframe` + `timestamp_us` (overlay sin drift).
- [ ] Frontend: `front/src/hooks/useWebCodecsStream.ts` crea `VideoDecoder`, configura al primer keyframe (SPS/PPS inband), dibuja `VideoFrame` a `<canvas>`. Drop policy: si `decodeQueueSize > 3`, descarta P-frames hasta próximo IDR.
- [ ] Frontend: extraer parser `parseFrame()` a `front/src/lib/streamFraming.ts` y reusar desde MJPEG + WC.
- [ ] Frontend: `useStream.ts` agrega `"wc"` como tercera opción del feature flag (mjpeg / wc / webrtc).
- [ ] Frontend: pre-check con `VideoDecoder.isConfigSupported({hardwareAcceleration: "prefer-hardware"})`; sin soporte → `failed` con mensaje sugiriendo otro modo.
- [ ] Validar: cel Android, 25-30 fps sostenidos tras 10 min, latencia glass-to-glass ≤ 500 ms, HW decode confirmado en `chrome://media-internals`.
- [ ] Validar: detection boxes alineadas (drift ≤ 50 ms, bundle en header).
- [ ] Validar: drop policy en funcionamiento (CPU throttle → fps baja pero latencia no acumula).
- [ ] Validar: multi-cliente (2-3 navegadores simultáneos) sin degradación cruzada.
- [ ] Validar: Chrome desktop ≥ 28 fps. Sin regresión en MJPEG ni WebRTC.

Ver `spec/12-05-26-webcodecs-websocket/`. Fase 27 (MJPEG perf) sigue siendo valiosa como fallback para Firefox Android, iOS Safari, y cualquier browser sin WebCodecs HW.

---

## Phase 29: TLS local en nginx del robot — secure context sin flag por device

**Goal:** servir `https://<robot>` con un cert válido para los devices del operador, eliminando la flag `chrome://flags/#unsafely-treat-insecure-origin-as-secure` que actualmente hay que setear en cada laptop y celu para que WebCodecs funcione.

**Contexto:** Phase 28 dejó WebCodecs operativo pero atado a un workaround manual: en cada device nuevo el operador tiene que abrir Chrome flags y agregar `http://192.168.0.10` al whitelist de "treat as secure". Eso no escala — un fundo nuevo, un celu de repuesto o un operador adicional fuerza el ritual cada vez. Además el tráfico actual va en texto plano por la LAN: cualquiera asociado al WiFi puede sniffear video, API tokens, y sesiones de conteo. TLS resuelve ambas cosas con cero costo en pesos (Phase 28 ya validó la suposición de que el operador usa Android Chrome, así que mkcert + cert self-signed cubre el caso). Sin esto, todo nuevo feature que dependa de secure context (Web Bluetooth, Web Serial, getUserMedia con cámaras locales, notificaciones push) hereda el mismo workaround.

- [ ] Generar CA local con `mkcert` en máquina del admin y cert para `robot.local` (o IP `192.168.0.10`) firmado por esa CA. Documentar el flujo en `back/scripts/setup-tls.sh` o equivalente.
- [ ] Actualizar plantilla nginx del robot (`back/templates/...` o donde viva) — listen 443 ssl, certificados desde `/etc/nginx/certs/robot.crt|key`, redirect HTTP→HTTPS en 80, reusar el bloque de `proxy_pass` actual.
- [ ] `make deploy-robot` deja los certs en `/etc/nginx/certs/` con permisos correctos. Variables en `.env.robot` para path del cert si conviene customizar.
- [ ] Documentar el setup per-device del CA root de mkcert (instructivo para operadores: una vez por device, link al archivo `.crt` de la CA).
- [ ] Actualizar `useStream.ts` / `streamFraming.ts` para que el WS use `wss://` cuando la página esté servida sobre HTTPS (`window.location.protocol === "https:"` → `wss:`). Ya está en el código de Phase 28; validar.
- [ ] Validar: con cert instalado en celu/laptop, `https://robot.local/vision` carga sin warnings, WebCodecs anda sin flag, lock candado verde.
- [ ] Validar: con cert NO instalado en un device nuevo, browser muestra warning pero permite "Continue anyway" — el feature aún funciona si el operador acepta.
- [ ] Validar: deploy `make update` sigue funcionando sin tocar el cert generado (no se regenera en cada deploy).
- [ ] Validar: rate limiting, auth y demás middleware no se rompen por el cambio de scheme.

Ver futuro `spec/<fecha>-tls-local-robot/`. Alternativas que se descartaron al planificar: Cloudflare Tunnel y Tailscale Funnel (requieren conectividad outbound del robot a la nube, no garantizada en fundos con WiFi propio); Let's Encrypt con dominio público (requiere FQDN y port forwarding, infra extra). mkcert es self-contained y suficiente para LAN privada.

---

## Pendiente (sin fecha)

- Clasificación offline de frutos (crops por track_id + modelo de calidad/madurez)
- Mapa offline (tiles descargados al robot para campo sin internet)
- Cámara por red WiFi (en vez de USB)
- Evaluación y finetuning del modelo YOLO para detección
- **Sincronización de estado de sesión entre clientes multi-device.** Observado en pruebas de Phase 28: con dos clientes conectados a `/vision` simultáneamente, las detections pueden mostrarse en un device y no en el otro. Causa raíz: el estado de sesión (`counter.get_active_session()`) es global en memoria del backend, pero el UI de cada cliente mantiene su propio "estado de sesión activa" local; si el operador A da click a "contar" desde su device y el operador B no, la UI de B no refleja que hay una sesión corriendo aunque el server sí la tenga. Riesgo concreto: dos operadores intentando iniciar sesiones de conteo en momentos diferentes (target_class distinto, doble click "contar") con resultados ambiguos sobre quién "ganó". Posibles soluciones a evaluar: (a) broadcast del estado de sesión al frontend via el mismo header binario que ya viaja con cada frame — el flag `session_active` ya está; falta que la UI lo respete y refresque su estado local, (b) WS canal de control aparte para eventos de sesión (start/stop/error), (c) lock explícito server-side que rechace start si ya hay sesión activa, con mensaje al cliente que pierde.
