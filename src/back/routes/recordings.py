"""HTTP routes for managing video recordings on the robot.

Server mode also serves the listing + downloads for recordings synced from
robots; only the start/stop/delete endpoints are robot-only.
"""

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from back.config import AppMode, config
from back.database import get_db
from back.models import (
    Camellon,
    DetectionModel,
    FruitCrop,
    Fundo,
    Recording,
    SyncLog,
)
from back.schemas import (
    RecordingOut,
    RecordingPlaceUpdate,
    RecountConfigOut,
    RecountRequest,
)
from back.services.recording_client import (
    RecordingClient,
    RecordingWorkerUnavailable,
)
from back.services.sync_recordings_upload import get_uploading_uuids

logger = logging.getLogger("recordings")

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_uuid() -> str:
    import uuid

    return str(uuid.uuid4())


def _client() -> RecordingClient:
    return RecordingClient(config.recording.control_socket_path)


async def _build_out(db: AsyncSession, row: Recording) -> RecordingOut:
    """Build RecordingOut with the resolved empresa → fundo → camellon chain."""
    camellon_nombre: str | None = None
    fundo_uuid: str | None = None
    fundo_nombre: str | None = None
    empresa_nombre: str | None = None
    if row.camellon_id is not None:
        cam_result = await db.execute(
            select(Camellon)
            .options(selectinload(Camellon.fundo).selectinload(Fundo.empresa))
            .where(Camellon.id == row.camellon_id)
        )
        camellon = cam_result.scalar_one_or_none()
        if camellon:
            camellon_nombre = camellon.nombre
            fundo_uuid = camellon.fundo_uuid
            if camellon.fundo:
                fundo_nombre = camellon.fundo.name
                if camellon.fundo.empresa:
                    empresa_nombre = camellon.fundo.empresa.name
    return RecordingOut(
        uuid=row.uuid,
        device_id=row.device_id,
        session_uuid=row.session_uuid,
        camellon_id=row.camellon_id,
        camellon_nombre=camellon_nombre,
        fundo_uuid=fundo_uuid,
        fundo_nombre=fundo_nombre,
        empresa_nombre=empresa_nombre,
        started_at=row.started_at,
        ended_at=row.ended_at,
        duration_seconds=row.duration_seconds,
        file_path=row.file_path,
        file_size_bytes=row.file_size_bytes,
        width=row.width,
        height=row.height,
        fps=row.fps,
        uploaded_at=row.uploaded_at,
        count_status=row.count_status,
        count=row.count,
        count_error=row.count_error,
        classification_status=row.classification_status,
        classification_error=row.classification_error,
    )


@router.post("/start", response_model=RecordingOut)
async def start_recording(db: AsyncSession = Depends(get_db)):
    if config.mode != AppMode.ROBOT:
        raise HTTPException(404, "Recordings can only be started on a robot")

    from back.config import get_device_id

    device_id = get_device_id()
    existing = await db.execute(
        select(Recording).where(
            (Recording.device_id == device_id) & (Recording.ended_at.is_(None))
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(409, "A recording is already in progress")

    uuid = _new_uuid()
    # Always send an absolute path: the recording-worker runs from a
    # different cwd, so a relative path resolves against /tmp or wherever
    # systemd dropped it and the MP4 ends up in the wrong place.
    output_path = os.path.abspath(
        os.path.join(config.storage.recordings_dir, f"{uuid}.mp4")
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # session_uuid: the active counting session is in-memory only and has no
    # uuid until the operator saves it. For now we always store NULL — the
    # recording stays independent of any counting session in DB. Future
    # phase: link by overlapping timestamps when a session is saved.
    session_uuid: str | None = None

    try:
        worker_resp = _client().start(uuid, output_path)
    except RecordingWorkerUnavailable as exc:
        logger.warning("Recording worker not available: %s", exc)
        raise HTTPException(503, "Recording worker is not available")

    if not worker_resp.get("ok"):
        err = worker_resp.get("error", "unknown")
        if err == "already_recording":
            # State drifted (worker thinks it's recording, DB doesn't).
            logger.error("Worker reports already_recording but DB has no open row")
            raise HTTPException(500, "Recording worker state inconsistent")
        if err == "camera_unavailable":
            raise HTTPException(503, "Camera worker is not available")
        raise HTTPException(500, f"Recording worker error: {err}")

    row = Recording(
        uuid=uuid,
        device_id=device_id,
        session_uuid=session_uuid,
        started_at=_now_iso(),
        file_path=output_path,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return await _build_out(db, row)


@router.post("/stop", response_model=RecordingOut)
async def stop_recording(db: AsyncSession = Depends(get_db)):
    if config.mode != AppMode.ROBOT:
        raise HTTPException(404, "Recordings can only be stopped on a robot")

    from back.config import get_device_id

    device_id = get_device_id()
    result = await db.execute(
        select(Recording).where(
            (Recording.device_id == device_id) & (Recording.ended_at.is_(None))
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(409, "No recording is active")

    try:
        worker_resp = _client().stop()
    except RecordingWorkerUnavailable as exc:
        logger.warning("Recording worker not available on stop: %s", exc)
        raise HTTPException(503, "Recording worker is not available")

    if not worker_resp.get("ok"):
        err = worker_resp.get("error", "unknown")
        # Drift recovery: worker is idle but DB had an open row (e.g. the
        # worker restarted while a recording was in flight). Close the
        # row gracefully and return 200 — the file may be incomplete but
        # the operator should not get stuck behind a 500 with no way out.
        logger.warning(
            "Worker stop returned not-ok (%s) — closing DB row to recover", err
        )
        row.ended_at = _now_iso()
        if not os.path.isfile(row.file_path):
            row.file_size_bytes = 0
        else:
            try:
                row.file_size_bytes = os.path.getsize(row.file_path)
            except OSError:
                row.file_size_bytes = 0
        await db.flush()
        await db.refresh(row)
        return await _build_out(db, row)

    row.ended_at = _now_iso()
    row.duration_seconds = worker_resp.get("duration_seconds")
    row.file_size_bytes = worker_resp.get("file_size_bytes")
    row.width = worker_resp.get("width")
    row.height = worker_resp.get("height")
    row.fps = worker_resp.get("fps")
    await db.flush()
    await db.refresh(row)
    return await _build_out(db, row)


@router.get("/", response_model=list[RecordingOut])
async def list_recordings(
    db: AsyncSession = Depends(get_db),
    camellon_id: int | None = Query(default=None),
    fundo_uuid: str | None = Query(default=None),
    device_id: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    stmt = select(Recording)
    if camellon_id is not None:
        stmt = stmt.where(Recording.camellon_id == camellon_id)
    if fundo_uuid is not None:
        # Resolve camellon ids for this fundo
        cam_result = await db.execute(
            select(Camellon.id).where(Camellon.fundo_uuid == fundo_uuid)
        )
        cam_ids = [r[0] for r in cam_result.fetchall()]
        stmt = stmt.where(Recording.camellon_id.in_(cam_ids))
    if device_id is not None:
        stmt = stmt.where(Recording.device_id == device_id)
    if from_ is not None:
        stmt = stmt.where(Recording.started_at >= from_)
    if to is not None:
        stmt = stmt.where(Recording.started_at <= to)
    stmt = stmt.order_by(Recording.started_at.desc())
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [await _build_out(db, row) for row in rows]


@router.put("/{uuid}/place", response_model=RecordingOut)
async def set_recording_place(
    uuid: str,
    body: RecordingPlaceUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")
    if body.camellon_id is not None:
        cam_result = await db.execute(
            select(Camellon).where(Camellon.id == body.camellon_id)
        )
        if cam_result.scalar_one_or_none() is None:
            raise HTTPException(422, f"camellon_id {body.camellon_id} not found")
    row.camellon_id = body.camellon_id
    # Re-mark for sync: delete sync_log entry so next push re-sends this row
    await db.execute(
        delete(SyncLog).where(
            (SyncLog.table_name == "recordings") & (SyncLog.record_uuid == uuid)
        )
    )
    await db.flush()
    await db.refresh(row)
    return await _build_out(db, row)


@router.get("/uploading")
async def uploading_uuids():
    return {"uuids": get_uploading_uuids()}


@router.get("/{uuid}/file")
async def download_recording(uuid: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")
    if not os.path.isfile(row.file_path):
        raise HTTPException(404, "Recording file is missing on disk")

    # FileResponse honors HTTP Range requests (sets Accept-Ranges), which the
    # video element needs to seek/scrub to unbuffered regions during replay.
    return FileResponse(
        row.file_path,
        media_type="video/mp4",
        filename=f"{uuid}.mp4",
    )


@router.get("/{uuid}/detections")
async def get_recording_detections(uuid: str, db: AsyncSession = Depends(get_db)):
    """Per-frame detections logged alongside a recording.

    Returns {"fps", "frames": [...]} where each frame is the parsed JSONL line
    {"frame", "pts", "dets"}. The counting-worker writes one dense line per MP4
    frame, each carrying that frame's own presentation timestamp ``pts``. The
    MP4 is variable-frame-rate, so the player matches its mediaTime against
    ``pts`` (largest pts ≤ mediaTime) to find the exact frame — never via
    index*fps. ``fps`` is informational. If the .jsonl is missing returns an
    empty frame list. Available in robot and server mode so the operator can
    replay synced recordings from the server.
    """
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")

    # The line/ROI/direction actually used for this count, snapshotted on the
    # row when it was enqueued. The replay overlays it so the operator can SEE
    # where the counting line was — e.g. a count of 0 with the line off to one
    # side, or detections of the wrong class, becomes obvious.
    count_config: dict | None = None
    if row.count_config:
        try:
            cc = json.loads(row.count_config)
            count_config = {
                "count_mode": cc.get("count_mode"),
                "threshold": cc.get("threshold"),
                "direction": cc.get("direction"),
                "roi_mode": cc.get("roi_mode"),
                # Counting method ("single"|"tiled"); old configs lack it → single.
                # The replay draws tiled's two tiles instead of the square ROI.
                "method": cc.get("method", "single"),
                # target_class is the system_label (display); target_model_label
                # is what the worker actually counted on and what the sidecar
                # `cls` equals — the replay overlay filters boxes by that.
                "target_class": cc.get("target_class"),
                "target_model_label": cc.get("target_model_label"),
            }
        except (json.JSONDecodeError, TypeError):
            count_config = None

    jsonl_path = os.path.join(os.path.dirname(row.file_path), f"{uuid}.jsonl")
    if not os.path.isfile(jsonl_path):
        return {"fps": row.fps, "frames": [], "count_config": count_config}

    frames = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    return {"fps": row.fps, "frames": frames, "count_config": count_config}


@router.get("/{uuid}/count-config", response_model=RecountConfigOut)
async def get_recount_config(uuid: str, db: AsyncSession = Depends(get_db)):
    """Config the re-process dialog prefills for a recording.

    Returns the params last used for this video (from its ``count_config``) if it
    was counted before, else the current global ``config.counting`` defaults. The
    operator reviews/edits these and POSTs them back to ``/recount``.
    """
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")

    cc = {}
    if rec.count_config:
        try:
            cc = json.loads(rec.count_config)
        except (json.JSONDecodeError, TypeError):
            cc = {}
    c = config.counting

    # The category (by target_class) is the deployment hub: it supplies the
    # default detector + geometry for the dialog when this video wasn't counted
    # before. Pinned count_config still wins (reproduce what was used).
    from back.models import Category

    cat = None
    target_class = cc.get("target_class")
    if target_class:
        res = await db.execute(select(Category).where(Category.name == target_class))
        cat = res.scalar_one_or_none()

    # Model + runtime to prefill: the video's pinned model if counted before,
    # else the category's detector, else the active model. Runtime from engine_path.
    model_uuid = cc.get("model_uuid")
    runtime = cc.get("runtime")
    if runtime is None and cc.get("engine_path"):
        runtime = "tensorrt" if cc["engine_path"].endswith(".engine") else "pytorch"
    if model_uuid is None and cat is not None:
        model_uuid = cat.detection_model_uuid
    if model_uuid is None:
        active = await db.execute(
            select(DetectionModel)
            .where(DetectionModel.selected_label.isnot(None))
            .limit(1)
        )
        am = active.scalars().first()
        if am is not None:
            model_uuid = am.uuid

    def _pref(key: str, cat_value, default):
        v = cc.get(key)
        if v is not None:
            return v
        return cat_value if cat_value is not None else default

    return RecountConfigOut(
        count_mode=_pref("count_mode", getattr(cat, "count_mode", None), c.count_mode),
        threshold=_pref("threshold", getattr(cat, "threshold", None), c.threshold),
        direction=_pref("direction", getattr(cat, "direction", None), c.direction),
        roi_mode=_pref("roi_mode", getattr(cat, "roi_mode", None), c.roi_mode),
        confidence=_pref(
            "confidence", getattr(cat, "confidence", None), c.confidence_threshold
        ),
        target_class=target_class,
        model_uuid=model_uuid,
        runtime=runtime,
        method=_pref("method", getattr(cat, "method", None), c.method),  # type: ignore[arg-type]
    )


@router.post("/{uuid}/recount", response_model=RecordingOut)
async def recount(
    uuid: str,
    use_active_model: bool = Query(default=False),
    body: RecountRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Re-run the offline count for a finished recording.

    Three modes:
    - With a request ``body`` of params (the re-process dialog): count with the
      active model + the reviewed/edited per-video params (line/ROI/class/conf).
    - ``use_active_model=true``: re-pin the active model, reuse the prior config's
      target_class (e.g. re-count old videos with an improved model).
    - Default: reproduce the number with the model pinned in ``count_config``.

    404 if unknown, 409 if the MP4 / required engine is missing.
    """
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")
    if rec.ended_at is None:
        raise HTTPException(409, "La grabación aún no ha terminado")
    if not os.path.isfile(rec.file_path):
        raise HTTPException(409, "El MP4 no está en disco")

    from back.services.perception.counting_trigger import (
        build_count_config,
        enqueue_count,
    )

    overrides = body.model_dump(exclude_none=True) if body else {}

    if overrides:
        prev = json.loads(rec.count_config) if rec.count_config else {}
        target_class = overrides.pop("target_class", None) or prev.get("target_class")
        model_uuid = overrides.pop("model_uuid", None)
        runtime = overrides.pop("runtime", None)
        try:
            cfg = await build_count_config(
                db,
                target_class,
                overrides=overrides,
                model_uuid=model_uuid,
                runtime=runtime,
            )
        except RuntimeError:
            raise HTTPException(409, "No hay un modelo de detección disponible")
        # Guard: TensorRT chosen but no built engine on disk → tell the operator
        # clearly instead of silently falling back / counting 0.
        if runtime == "tensorrt":
            ep = cfg.get("engine_path") or ""
            if not ep.endswith(".engine") or (
                os.sep in ep and not os.path.exists(ep)
            ):
                raise HTTPException(
                    409,
                    "El modelo no tiene un engine TensorRT construido; usa PyTorch",
                )
    elif use_active_model:
        prev = json.loads(rec.count_config) if rec.count_config else {}
        try:
            cfg = await build_count_config(db, prev.get("target_class"))
        except RuntimeError:
            raise HTTPException(409, "No hay un modelo de detección activo")
    else:
        if not rec.count_config:
            raise HTTPException(
                409, "No hay count_config para reproducir; usa use_active_model=true"
            )
        cfg = json.loads(rec.count_config)
        engine_path = cfg.get("engine_path") or ""
        if os.sep in engine_path and not os.path.exists(engine_path):
            raise HTTPException(
                409, "El engine fijado ya no está en disco; usa use_active_model=true"
            )

    await enqueue_count(db, rec, cfg)
    await db.flush()
    await db.refresh(rec)
    return await _build_out(db, rec)


@router.post("/{uuid}/upload-count", response_model=RecordingOut)
async def upload_count(
    uuid: str,
    file: UploadFile = File(...),
    total_count: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Attach a manually-produced count to a recording, bypassing counting-worker.

    For experimenting with detection/tracking off the robot (own laptop, cloud):
    download the MP4 via ``GET /file``, run any pipeline that reproduces the
    counting-worker's per-frame JSONL contract (one line per frame:
    ``{"frame","pts","dets":[{"cls","conf","bbox","track_id"}]}``), then upload
    the result here. ``total_count`` is optional — if omitted it's derived as
    the number of distinct ``track_id``s seen across all frames.

    404 if unknown, 409 if the recording hasn't finished, 422 if the file has
    no valid JSONL lines.
    """
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")
    if rec.ended_at is None:
        raise HTTPException(409, "La grabación aún no ha terminado")
    if total_count is not None and total_count < 0:
        raise HTTPException(422, "total_count no puede ser negativo")

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(422, "El archivo no es texto UTF-8 válido")

    track_ids: set[int] = set()
    valid_lines = 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        valid_lines += 1
        for det in frame.get("dets") or []:
            tid = det.get("track_id")
            if tid is not None:
                track_ids.add(tid)

    if valid_lines == 0:
        raise HTTPException(422, "El archivo no tiene líneas JSONL válidas")

    jsonl_path = os.path.join(os.path.dirname(rec.file_path), f"{uuid}.jsonl")
    os.makedirs(os.path.dirname(jsonl_path), exist_ok=True)
    with open(jsonl_path, "w") as f:
        f.write(text)

    rec.count = total_count if total_count is not None else len(track_ids)
    rec.count_status = "done"
    rec.count_error = None
    rec.count_config = json.dumps({"source": "manual_upload", "uploaded_at": _now_iso()})
    # New sidecar content — clear so the sync poller re-pushes it (mirrors
    # what the offline counting-worker does when a (re)count finishes).
    rec.detections_uploaded_at = None

    await db.flush()
    await db.refresh(rec)
    return await _build_out(db, rec)


@router.post("/{uuid}/reclassify", response_model=RecordingOut)
async def reclassify(
    uuid: str,
    use_pinned: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Re-run offline ripeness classification for a counted recording.

    Needs the recording counted (so ``{uuid}.crossings.jsonl`` exists). By default
    rebuilds the classifier pin from the category; ``use_pinned=true`` reproduces
    the ``classification_config`` already on the row.

    404 if unknown; 409 if not counted, the MP4 is missing, or the category has no
    classifier assigned.
    """
    rec = (
        await db.execute(select(Recording).where(Recording.uuid == uuid))
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")
    if not os.path.isfile(rec.file_path):
        raise HTTPException(409, "El MP4 no está en disco")
    if rec.count_status != "done":
        raise HTTPException(409, "La grabación no está contada; cuenta primero")

    from back.services.perception.classification_trigger import (
        build_classification_config,
        enqueue_classification,
    )

    if use_pinned:
        if not rec.classification_config:
            raise HTTPException(
                409, "No hay classification_config para reproducir; reclasifica normal"
            )
        cfg = json.loads(rec.classification_config)
    else:
        cfg = await build_classification_config(db, rec)
        if cfg is None:
            raise HTTPException(409, "La categoría no tiene un clasificador asignado")

    await enqueue_classification(db, rec, cfg)
    await db.flush()
    await db.refresh(rec)
    return await _build_out(db, rec)


@router.get("/{uuid}/classifications")
async def get_recording_classifications(
    uuid: str, db: AsyncSession = Depends(get_db)
):
    """Ripeness classification results for a recording — summary + crop gallery.

    Returns ``{status, error, distribution, crops}`` where ``distribution`` is a
    per-class count and each crop carries its predicted label/confidence, bbox and
    crop image filename. Available in robot and server mode. Empty crop list while
    classification hasn't produced results yet.
    """
    rec = (
        await db.execute(select(Recording).where(Recording.uuid == uuid))
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")

    crops = (
        await db.execute(
            select(FruitCrop)
            .options(selectinload(FruitCrop.classifications))
            .where(FruitCrop.recording_uuid == uuid)
            .order_by(FruitCrop.track_id)
        )
    ).scalars().all()

    distribution: dict[str, int] = {}
    out_crops = []
    for crop in crops:
        cl = crop.classifications[0] if crop.classifications else None
        label = cl.class_name if cl else None
        if label is not None:
            distribution[label] = distribution.get(label, 0) + 1
        out_crops.append(
            {
                "track_id": crop.track_id,
                "label": label,
                "confidence": cl.confidence if cl else None,
                "bbox": [crop.bbox_x, crop.bbox_y, crop.bbox_w, crop.bbox_h],
                "crop": os.path.basename(crop.image_path),
            }
        )

    return {
        "status": rec.classification_status,
        "error": rec.classification_error,
        "distribution": distribution,
        "crops": out_crops,
    }


def _resolve_crop_path(crops_dir: str, filename: str) -> str:
    """Resolve a crop filename under ``crops_dir``, or raise 400/404.

    Rejects any path separator / ``..`` so a request can never escape the crops
    dir (path traversal). 404 when the file doesn't exist. Pure so it's unit
    testable without an HTTP/DB harness."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid crop filename")
    path = os.path.join(crops_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Crop image not found")
    return path


@router.get("/{uuid}/crops/{filename}")
async def get_recording_crop(
    uuid: str, filename: str, db: AsyncSession = Depends(get_db)
):
    """Serve a single ripeness crop JPG for a recording.

    ``filename`` is the bare basename the ``/classifications`` payload carries
    (e.g. ``7_214.jpg``); this resolves it under the recording's crops dir. Any
    path separator / ``..`` is rejected so the route can never escape that dir.
    Available in robot and server mode (the server has the synced crops).
    """
    rec = (
        await db.execute(select(Recording).where(Recording.uuid == uuid))
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recording not found")

    from back.services.perception.classification_trigger import crops_dir_for

    path = _resolve_crop_path(crops_dir_for(rec), filename)
    return FileResponse(path, media_type="image/jpeg", filename=filename)


@router.delete("/{uuid}")
async def delete_recording(uuid: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")

    file_path = row.file_path
    await db.delete(row)
    await db.flush()
    try:
        os.unlink(file_path)
    except FileNotFoundError:
        pass
    return {"ok": True, "uuid": uuid}
