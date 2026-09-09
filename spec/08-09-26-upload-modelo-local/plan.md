# Plan: Subida de modelos directa en el robot

**Objetivo.** Sacar al server del camino crítico del despliegue de modelos. Hoy un
modelo entrenado solo llega al robot vía `sync_pull.pull_models()`, así que si el
ingress del server está caído (Funnel/DNS, ver `docs/tailscale.md`) el equipo de IA
queda bloqueado hasta arreglar infraestructura. Con esto el operador sube el `.pt`
por la UI del propio robot, se registra en su DB local y se convierte a TensorRT sin
que el server participe.

El server sigue siendo la ruta normal de distribución y la única crítica para la
ingesta de datos de las visitas. Esto es la vía alterna, no el reemplazo.

---

## Group 1: Backend — endpoint de subida en modo robot

1. En `back/routes/models_local.py`, nuevo `POST /api/models/upload` (multipart).
   Reusa la lógica de `admin_models.upload_detection_model` (`routes/admin_models.py:72`):
   guardar bajo `config.storage.models_dir`, calcular sha256, insertar `DetectionModel`.
   Diferencias:
   - `source="local"` — valor nuevo, distinto de `uploaded` (viene del server) y
     `library` (ultralytics). Es la marca que usa el Group 2.
   - `uploaded_by="robot"`, `is_active=True`. Campos de métricas opcionales.
   - Validar extensión `.pt` y rechazar `file.filename` con separadores de ruta:
     hoy el nombre del cliente se concatena directo al path de destino.
   - `409` si ya existe un `DetectionModel` con ese filename.
   - Mismo `_require_robot_mode()` que el resto del router.

2. Escribir a disco por chunks en vez de `await file.read()`. El endpoint del server
   carga el archivo completo en memoria; en la Jetson eso es peor.

3. `DELETE /api/models/{uuid}` en el mismo router: borra la fila, el `.pt` y el
   `.engine` cacheado (`engine_cache_path_for`). Solo para `source == "local"` —
   los que vienen del server los gobierna el sync. Sin esto no hay manera de sacar
   un modelo subido a mano.

## Group 2: Que el sync no lo borre

4. `services/sync_pull.py:33-41` (`_upsert_models`): excluir `source == "local"` del
   borrado por desasignación. Hoy elimina toda fila cuyo filename no esté en la lista
   que manda el server, así que un modelo subido en el robot desaparece en el
   siguiente pull exitoso y el `.pt` queda huérfano en disco.

5. En el paso 3 de `pull_models()`, los locales no se descargan ni se les recalcula
   hash: ya están en disco y el server no tiene autoridad sobre ellos.

6. Test: subir un modelo local → correr `pull_models()` con una lista remota que no
   lo incluye → la fila local sobrevive y el `.pt` sigue en `models_dir`.

## Group 3: Frontend

7. `front/src/api/models.ts`: `uploadLocalModel(FormData)` y `deleteLocalModel(uuid)`.

8. `front/src/modules/settings/components/AssignedModelsCard.tsx`: botón "Subir
   modelo" + diálogo. Base: `modules/admin/components/ModelUploadDialog.tsx`,
   recortado a lo que el robot necesita (archivo, versión, `class_mapping`, notas).

9. Distinguir el origen en la lista (`local` vs `sync`), para que el operador sepa
   cuál sobrevive a un re-sync y cuál lo administra el server.

## Group 4: Ciclo completo

10. `worker_model_path_for` no necesita cambios: `source="local"` cae en la rama
    `models_dir/filename` de `actual_pt_path_for`, igual que `uploaded`.

11. Toggle TensorRT sobre un modelo local: el `file_hash` ya viene del upload, así
    que `set_model_tensorrt` va directo al `ConversionClient` sin el caso especial
    de los library.

12. `select_label` y `model_reconciler` no cambian: leen de la DB local, que ya es
    la fuente de verdad.

---

## Fuera de alcance

- Empujar el modelo local hacia el server como inventario. Por ahora el server no
  se entera de que existe.
- Auth en el endpoint. En modo robot no hay guard global (`back/routes/README.md`),
  y este endpoint escribe archivos en disco desde la LAN. Se mantiene el criterio
  actual del robot; si se quiere cerrar, es una decisión aparte para todo el modo
  robot, no solo para esta ruta.
