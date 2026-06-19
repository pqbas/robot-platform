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
from back.models import Camellon, Recording, SyncLog
from back.schemas import RecordingOut, RecordingPlaceUpdate
from back.services import detection_recorder
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

    detection_recorder.start(uuid, config.storage.recordings_dir)

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

    detection_recorder.stop()

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


def _iso_to_epoch(iso: str | None) -> float | None:
    """Parse the stored ISO timestamp ('%Y-%m-%dT%H:%M:%SZ', UTC) to epoch
    seconds. Second-resolution, which is enough to anchor replay (±~1s)."""
    if not iso:
        return None
    try:
        return (
            datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
            .replace(tzinfo=timezone.utc)
            .timestamp()
        )
    except ValueError:
        return None


@router.get("/{uuid}/detections")
async def get_recording_detections(uuid: str, db: AsyncSession = Depends(get_db)):
    """Per-frame detections logged alongside a recording.

    Returns {"fps", "started_epoch", "frames": [...]} where each frame is the
    parsed JSONL line {"frame", "t", "dets"}. ``started_epoch`` is the recording
    start (= video time 0) in epoch seconds, so the player can map
    video.currentTime to a detection wall-clock ``t`` directly. Anchoring to the
    first detection instead would skip the camera/inference warmup gap before the
    first logged detection and shift the whole track early. If the .jsonl is
    missing returns an empty frame list. Available in robot and server mode so the
    operator can replay synced recordings from the server.
    """
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")

    started_epoch = _iso_to_epoch(row.started_at)
    jsonl_path = os.path.join(os.path.dirname(row.file_path), f"{uuid}.jsonl")
    if not os.path.isfile(jsonl_path):
        return {"fps": row.fps, "started_epoch": started_epoch, "frames": []}

    frames = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    return {"fps": row.fps, "started_epoch": started_epoch, "frames": frames}


@router.post("/{uuid}/recount", response_model=RecordingOut)
async def recount(
    uuid: str,
    use_active_model: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Re-run the offline count for a finished recording.

    Default reproduces the original number with the model pinned in
    ``count_config`` (deterministic). ``use_active_model=true`` re-pins the
    currently active model and counts with it (e.g. to re-count old videos with
    an improved model). 404 if unknown, 409 if the MP4 / required engine is
    missing.
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

    if use_active_model:
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
