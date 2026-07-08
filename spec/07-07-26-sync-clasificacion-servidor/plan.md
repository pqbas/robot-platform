# Plan: Sync de clasificación de madurez robot → servidor

Espeja el flujo ya probado de detecciones (`_upload_detections` + receiver
`/detections/upload`) para clasificación. Sin migración (columnas/tablas ya en
`022`). Los pasos están numerados de corrido.

## Group 1: Metadata en el push/receive de recordings

1. `src/back/schemas.py` — en `class SyncRecording` (línea ~472) añadir tres
   campos, después de `count_config`:
   - `classification_status: str = "none"`
   - `classification_error: str | None = None`
   - `classification_config: str | None = None`

2. `src/back/services/sync_push.py` — en el bloque `# 8. Recordings` (dict de
   `data.append(...)`, línea ~184), añadir esos tres campos leídos de `r`:
   - `"classification_status": r.classification_status`
   - `"classification_error": r.classification_error`
   - `"classification_config": r.classification_config`

3. `src/back/services/sync_receive.py` — en `receive_recordings`, propagar los
   tres campos:
   - En la rama `existing is not None` (upsert, junto a `existing.count* = ...`):
     `existing.classification_status = item.classification_status`,
     `existing.classification_error = item.classification_error`,
     `existing.classification_config = item.classification_config`.
   - En el `db.add(Recording(...))` (insert), añadir los tres kwargs homónimos.

---

## Group 2: Transcripción compartida jsonl → filas

4. Crear `src/back/services/perception/classification_ingest.py`:
   - Mover el núcleo de `classification_poller._transcribe_results` a una función
     reutilizable `async def transcribe_classifications(rec: Recording) -> int`
     que: borra `FruitCrop`/`FruitClassification` previos de `rec.uuid`, lee
     `classifications_path_for(rec)` línea a línea, crea `FruitCrop` (con
     `image_path = crops_dir_for(rec)/crop_name`, bbox, `track_id`) +
     `FruitClassification` (`class_name=d["label"]`, `confidence`, `model_uuid`
     de `classification_config`), commit. Devuelve nº de crops.
   - Debe funcionar con `AsyncSessionLocal()` propio (igual que hoy), para que el
     server lo llame sin pasar sesión.

5. `src/back/services/perception/classification_poller.py` — reemplazar el cuerpo
   de `_transcribe_results` por `from .classification_ingest import
   transcribe_classifications` y delegar (o borrar `_transcribe_results` y llamar
   directo a `transcribe_classifications`). Verificar que
   `_process_worker_result` sigue llamando la función correcta.

6. `src/back/services/perception/classification_poller.py` — en
   `_process_worker_result`, rama `ok`, junto a `row.classifications_uploaded_at =
   None` (línea ~171) añadir `row.crops_uploaded_at = None` para que los recortes
   regenerados por un reclassify también se re-empujen.

---

## Group 3: Upload robot (jsonl + crossings + crops)

7. `src/back/services/sync_recordings_upload.py` — añadir helpers espejando
   `_upload_detections`:
   - `async def _upload_classification_sidecars(http, row, base_url) -> bool`:
     POST `{uuid}.classifications.jsonl` a
     `{base_url}/api/sync/recordings/{uuid}/classifications/upload`
     (content_type `application/x-ndjson`). Si existe, subir también
     `{uuid}.crossings.jsonl` al mismo endpoint o a `/crossings/upload`
     (decisión de impl: un solo endpoint que reciba ambos por nombre, o dos —
     preferir dos endpoints simétricos y simples). Devuelve éxito del principal
     (classifications).
   - `async def _upload_crops(http, row, base_url) -> bool`: iterar los JPG de
     `crops_dir_for(rec)` y hacer POST de cada uno a
     `{base_url}/api/sync/recordings/{uuid}/crops/upload` (multipart `file`,
     filename = basename). Devuelve True solo si todos suben. Streaming por
     archivo (handle, no `read()`), uno a la vez.
   - Importar `crops_dir_for`, `classifications_path_for`, `crossings_path_for`
     de `back.services.perception.classification_trigger`.

8. `src/back/services/sync_recordings_upload.py` — añadir el predicado + el
   "if ready", espejando `_sidecar_needs_upload` / `_push_sidecar_if_ready`:
   - `_CLASSIFYING_IN_PROGRESS = ("pending", "classifying")`.
   - `def _classifications_need_upload(classification_status, classifications_uploaded_at, uploaded_at) -> bool`:
     `uploaded_at is not None and classification_status not in
     _CLASSIFYING_IN_PROGRESS and classifications_uploaded_at is None`.
   - `async def _push_classifications_if_ready(db, http, row, base_url)`:
     si no aplica, return. Si no existe el jsonl, marcar
     `classifications_uploaded_at = _utcnow_iso()` (reconciliado, nada que subir)
     y commit. Si sube ok, set `classifications_uploaded_at`. Luego, si
     `crops_uploaded_at is None` y hay crops, `_upload_crops`; si ok set
     `crops_uploaded_at = _utcnow_iso()`. Commit.

9. `src/back/services/sync_recordings_upload.py` — cablear en los dos flujos:
   - `upload_pending_recordings`: añadir una query `classification_rows`
     (recordings con `classification_status NOT IN _CLASSIFYING_IN_PROGRESS`
     AND `classifications_uploaded_at IS NULL` AND `uploaded_at IS NOT NULL`
     AND `ended_at IS NOT NULL`); tras el loop de sidecars, iterar y llamar
     `_push_classifications_if_ready` (re-chequeando `_is_metadata_synced`).
   - `upload_single_recording`: tras `_push_sidecar_if_ready(...)`, llamar
     `_push_classifications_if_ready(db, http, row, config.sync.lan_url)` para que
     el botón de sync manual arrastre también la clasificación.

---

## Group 4: Receiver en el server

10. `src/back/routes/sync.py` — dentro del bloque `if config.mode ==
    AppMode.SERVER`, añadir endpoints espejando `upload_recording_detections`
    (mismo guard `device_id`, `os.makedirs`, streaming por chunks):
    - `POST /recordings/{uuid}/classifications/upload`: guardar el archivo en
      `classifications_path_for(row)` (derivar de `crops_dir`/paths helper con el
      `file_path` del server). Tras escribir, llamar
      `transcribe_classifications(row)` para poblar `fruit_crops`/
      `fruit_classifications`. Responder `{ok, uuid, crops: n}`.
    - `POST /recordings/{uuid}/crossings/upload`: guardar en
      `crossings_path_for(row)`. Sin transcripción.
    - `POST /recordings/{uuid}/crops/upload`: guardar el JPG en
      `crops_dir_for(row)` (`os.makedirs(crops_dir, exist_ok=True)`,
      `out_path = crops_dir/filename`, sanear `filename` con el mismo criterio
      que `_resolve_crop_path` — rechazar separadores/`..`). Responder `{ok}`.
    - Importar `classifications_path_for`, `crossings_path_for`, `crops_dir_for`
      de `classification_trigger` y `transcribe_classifications` de
      `classification_ingest`.

11. `src/back/routes/sync.py` — verificar que el `filename` de crops se sanea
    reutilizando/espejando `routes.recordings._resolve_crop_path` (400 en
    separador/`..`) para no permitir escribir fuera de `crops_dir`.

---

## Group 5: Tests

12. `src/back/tests/` — añadir/extender tests:
    - `receive_recordings`: un `SyncRecording` con `classification_status="done"`
      + config inserta y, en re-push, hace upsert de los tres campos.
    - `_classifications_need_upload`: True solo con `uploaded_at` seteado, estado
      estático y flag NULL; False si `classifying`/`pending`, si `uploaded_at`
      None, o si el flag ya tiene timestamp.
    - `transcribe_classifications`: dado un `{uuid}.classifications.jsonl` de
      prueba, crea N `FruitCrop` + N `FruitClassification` y es idempotente
      (segunda corrida borra y reinserta, no duplica).
