# Validation: Verificación del conteo con pesos estándar

Implementation is complete and ready to ship when los checks abajo pasan en el robot real (Jetson) con el laboratorio configurado.

## Automated Tests

- [ ] `uv run pyright` (en raíz) sale sin errores
- [ ] `npm run build` (en `front/`) compila sin errores
- [ ] `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head` aplica la migración 003 sin errores en PostgreSQL
- [ ] `ENV_FILE=.env.robot uv run alembic -c back/alembic.ini upgrade head` aplica la migración 003 sin errores en SQLite

### Specific test coverage required

No se requieren tests unitarios nuevos. La verificación es operativa.

## Manual Checks

**Registro del library model (servidor):**

- [ ] En `ModelsPage` aparece el botón "Registrar modelo de librería" (junto al upload existente)
- [ ] Submit con `filename=yolo11n.pt`, `version=yolo11n-coco-v1`, `class_mapping=[{"model_label":"person","system_label":"Persona"}]`, `is_active=true` crea el modelo y lo muestra en la tabla
- [ ] El modelo creado aparece con `source=library` (verificable en DB: `SELECT filename, source, file_hash FROM detection_models;` — `source` debe ser `"library"` y `file_hash` `NULL`)
- [ ] **No** se creó archivo en `data/server/models/` ni en `data/robot/models/`
- [ ] Intentar reemplazar el `.pt` del library model vía PATCH/upload → falla con `400`

**Asignación + sync al robot:**

- [ ] Asignar `yolo11n.pt` al robot desde `DevicesPage` → la asignación queda guardada
- [ ] Forzar `POST /api/sync/pull` en el robot → logs muestran `is library model, skipping download`
- [ ] El registro aparece en la DB SQLite del robot (`SELECT filename, source FROM detection_models;`)
- [ ] **No** se creó `/opt/robot-platform/data/robot/models/yolo11n.pt` por sync

**Hot-swap y carga via ultralytics:**

- [ ] Operador entra a `VisionPage` → `ObjectPicker` muestra "Persona"
- [ ] Operador selecciona "Persona" → respuesta `200` de `POST /api/config/select-label`
- [ ] Logs del worker muestran que ultralytics descargó/cargó `yolo11n.pt` (primera vez puede tardar unos segundos por la descarga)
- [ ] El servicio `inference-worker` no se reinició (`systemctl status inference-worker` antes/después muestra mismo `Active: active (running) since ...`)

**Conteo en condiciones de laboratorio:**

- [ ] Stream WebRTC se ve sin lag perceptible y con bounding boxes sobre personas detectadas
- [ ] La línea de conteo se dibuja sobre el video según `CountingConfig.threshold`
- [ ] Una persona cruzando en la dirección configurada → contador +1
- [ ] Una persona cruzando en la dirección opuesta → comportamiento esperado documentado (no incrementa o decrementa, según diseño actual de `ObjectCounter`)
- [ ] Tres personas cruzando en secuencia → contador termina en +3
- [ ] Sesión termina y queda guardada con el conteo correcto

**Resiliencia:**

- [ ] Cambiar a otro modelo asignado y volver a "Persona" funciona sin errores ni reinicios
- [ ] Reiniciar `inference-worker` con `sudo systemctl restart inference-worker` y volver a seleccionar "Persona" funciona (descarga ya cacheada)

## Post-deploy Checks

No aplica — esta fase no introduce un deploy nuevo más allá del rebuild del frontend y el restart del backend tras la migración.

## Definition of Done

Migración 003 aplicada en server y robot, library model `yolo11n.pt` registrado y asignado, conteo verificado en el laboratorio con personas reales, todos los manual checks marcados con resultado anotado.
