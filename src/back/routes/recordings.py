"""HTTP routes for managing video recordings on the robot.

Server mode also serves the listing + downloads for recordings synced from
robots; only the start/stop/delete endpoints are robot-only.
"""

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import Camellon, DetectionModel, Recording, SyncLog
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
    """Build RecordingOut with resolved camellon_nombre and fundo_uuid."""
    camellon_nombre: str | None = None
    fundo_uuid: str | None = None
    if row.camellon_id is not None:
        cam_result = await db.execute(
            select(Camellon).where(Camellon.id == row.camellon_id)
        )
        camellon = cam_result.scalar_one_or_none()
        if camellon:
            camellon_nombre = camellon.nombre
            fundo_uuid = camellon.fundo_uuid
    return RecordingOut(
        uuid=row.uuid,
        device_id=row.device_id,
        session_uuid=row.session_uuid,
        camellon_id=row.camellon_id,
        camellon_nombre=camellon_nombre,
        fundo_uuid=fundo_uuid,
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
                "target_class": cc.get("target_class"),
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

    # Model + runtime to prefill: the video's pinned model if counted before,
    # else the active model. Runtime derived from the pinned engine_path.
    model_uuid = cc.get("model_uuid")
    runtime = cc.get("runtime")
    if runtime is None and cc.get("engine_path"):
        runtime = "tensorrt" if cc["engine_path"].endswith(".engine") else "pytorch"
    if model_uuid is None:
        active = await db.execute(
            select(DetectionModel)
            .where(DetectionModel.selected_label.isnot(None))
            .limit(1)
        )
        am = active.scalars().first()
        if am is not None:
            model_uuid = am.uuid

    return RecountConfigOut(
        count_mode=cc.get("count_mode", c.count_mode),
        threshold=cc.get("threshold", c.threshold),
        direction=cc.get("direction", c.direction),
        roi_mode=cc.get("roi_mode", c.roi_mode),
        confidence=cc.get("confidence", c.confidence_threshold),
        target_class=cc.get("target_class"),
        model_uuid=model_uuid,
        runtime=runtime,
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
