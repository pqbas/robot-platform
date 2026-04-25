"""HTTP routes for managing video recordings on the robot.

Server mode also serves the listing + downloads for recordings synced from
robots; only the start/stop/delete endpoints are robot-only.
"""

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import Recording
from back.schemas import RecordingOut
from back.services.recording_client import (
    RecordingClient,
    RecordingWorkerUnavailable,
)

logger = logging.getLogger("recordings")

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_uuid() -> str:
    import uuid

    return str(uuid.uuid4())


def _client() -> RecordingClient:
    return RecordingClient(config.recording.control_socket_path)


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
    output_path = os.path.join(config.storage.recordings_dir, f"{uuid}.mp4")
    os.makedirs(config.storage.recordings_dir, exist_ok=True)

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
    return row


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
        # If the worker isn't recording but our DB says it is, force-close
        # the row so the operator isn't stuck. File may be incomplete.
        logger.warning("Worker stop failed (%s) — closing DB row anyway", err)
        row.ended_at = _now_iso()
        await db.flush()
        raise HTTPException(500, f"Recording worker error: {err}")

    row.ended_at = _now_iso()
    row.duration_seconds = worker_resp.get("duration_seconds")
    row.file_size_bytes = worker_resp.get("file_size_bytes")
    row.width = worker_resp.get("width")
    row.height = worker_resp.get("height")
    row.fps = worker_resp.get("fps")
    await db.flush()
    await db.refresh(row)
    return row


@router.get("/", response_model=list[RecordingOut])
async def list_recordings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Recording).order_by(Recording.started_at.desc())
    )
    return result.scalars().all()


@router.get("/{uuid}/file")
async def download_recording(uuid: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Recording not found")
    if not os.path.isfile(row.file_path):
        raise HTTPException(404, "Recording file is missing on disk")

    def stream():
        with open(row.file_path, "rb") as f:
            while chunk := f.read(1_048_576):
                yield chunk

    headers = {
        "Content-Disposition": f'attachment; filename="{uuid}.mp4"',
        "Content-Length": str(os.path.getsize(row.file_path)),
    }
    return StreamingResponse(stream(), media_type="video/mp4", headers=headers)


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
