import csv
import io
import logging
import os
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.models import Event, Recording, Session, SyncLog
from back.schemas import (
    CountingStartRequest,
    CountingStatusOut,
    CountingStopOut,
    EventOut,
    SessionOut,
    SessionSave,
    SessionUpdate,
)
from back.services import storage
from back.services.perception import counter

logger = logging.getLogger("counting")

router = APIRouter(prefix="/api", tags=["sessions"])


# --- Live counting (in-memory, no DB) ---


@router.post("/counting/start", response_model=CountingStatusOut)
async def start_counting(body: CountingStartRequest, db: AsyncSession = Depends(get_db)):
    if counter.is_session_active():
        raise HTTPException(409, "Counting is already active")
    sess = counter.start_counting(body.target_class)
    # Auto-start a recording so every counting session is backed by a video +
    # detection log. Reuses recordings.start_recording; a 409 (recording
    # already active) or any other error must not abort the counting session.
    from back.routes.recordings import start_recording

    try:
        rec = await start_recording(db)
        sess.recording_uuid = rec.uuid
    except HTTPException as exc:
        logger.info("Auto-start recording skipped: %s", exc.detail)
    return CountingStatusOut(
        active=True,
        target_class=body.target_class,
        start_time=sess.start_time,
        total_count=0,
    )


@router.post("/counting/stop", response_model=CountingStopOut)
async def stop_counting(db: AsyncSession = Depends(get_db)):
    if not counter.is_session_active():
        raise HTTPException(409, "No counting is active")
    total_count, target_class = counter.stop_counting()
    # Stop the recording started alongside this counting session.
    from back.routes.recordings import stop_recording

    try:
        await stop_recording(db)
    except HTTPException as exc:
        logger.info("Auto-stop recording skipped: %s", exc.detail)

    # El conteo offline NO se dispara al detener: es caro (~5x tiempo real) y
    # compite con la inferencia en vivo. La grabación queda en count_status
    # 'none' (default del modelo) y se cuenta bajo demanda vía
    # POST /api/recordings/{uuid}/recount (build_count_config + enqueue_count).
    return CountingStopOut(total_count=total_count, target_class=target_class)


@router.post("/counting/discard")
async def discard_counting(db: AsyncSession = Depends(get_db)):
    """Drop the recording auto-started with the last counting session.

    Deletes the Recording row and its {uuid}.mp4 / {uuid}.jsonl files. Idempotent:
    returns discarded=None when there is no last recording to drop.
    """
    uuid = counter.get_last_recording_uuid()
    if uuid is None:
        return {"ok": True, "discarded": None}

    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    mp4_path = row.file_path if row else os.path.join(
        config.storage.recordings_dir, f"{uuid}.mp4"
    )
    if row is not None:
        await db.delete(row)
        await db.flush()

    base_dir = os.path.dirname(mp4_path)
    for path in (mp4_path, os.path.join(base_dir, f"{uuid}.jsonl")):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

    counter.clear_last_recording_uuid()
    return {"ok": True, "discarded": uuid}


@router.get("/counting/status", response_model=CountingStatusOut)
async def counting_status():
    sess = counter.get_active_session()
    if sess is None:
        return CountingStatusOut(active=False)
    return CountingStatusOut(
        active=True,
        target_class=sess.target_class,
        start_time=sess.start_time,
        total_count=sess.last_frame_count,
    )


async def _link_recording_camellon(db: AsyncSession, camellon_id: int) -> None:
    """Assign camellon_id to the Recording auto-started with the active session.

    No-op if there is no active counting session or it has no recording_uuid.
    """
    sess = counter.get_active_session()
    recording_uuid = sess.recording_uuid if sess else None
    if recording_uuid is None:
        # Session already stopped: fall back to the last stopped session's uuid.
        recording_uuid = counter.get_last_recording_uuid()
    if recording_uuid is None:
        return
    result = await db.execute(
        select(Recording).where(Recording.uuid == recording_uuid)
    )
    rec = result.scalar_one_or_none()
    if rec is not None:
        rec.camellon_id = camellon_id


# --- Sessions (DB persistence) ---


@router.get("/sessions/devices", response_model=list[str])
async def list_session_devices(db: AsyncSession = Depends(get_db)):
    return await storage.list_session_devices(db)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    device_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await storage.list_sessions(db, date_from, date_to, device_id)


@router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    return sess


@router.get("/sessions/{session_id}/events", response_model=list[EventOut])
async def get_session_events(session_id: int, db: AsyncSession = Depends(get_db)):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    return await storage.get_session_events(db, session_id)


@router.get("/sessions/{session_id}/export")
async def export_session_csv(session_id: int, db: AsyncSession = Depends(get_db)):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    events = await storage.get_session_events(db, session_id)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "session_id", "timestamp", "object_class", "track_id"])
    for ev in events:
        writer.writerow([ev.id, ev.session_id, ev.timestamp, ev.object_class, ev.track_id])
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=session_{session_id}.csv"},
    )


@router.patch("/sessions/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: int, body: SessionUpdate, db: AsyncSession = Depends(get_db)
):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")

    if body.camellon_id is not None:
        cam = await storage.get_camellon(db, body.camellon_id)
        if cam is None:
            raise HTTPException(404, "Camellon not found")
        sess.camellon_id = body.camellon_id
        await _link_recording_camellon(db, body.camellon_id)

    if body.start_time is not None:
        try:
            datetime.fromisoformat(body.start_time.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "start_time no es una fecha ISO 8601 válida")
        sess.start_time = body.start_time

    # Re-queue for sync: a session is pushed once (often unlocated), and sync is
    # insert-only, so drop its sync_log row to re-push the new location/date. The
    # server upserts camellon_id/start_time for an existing session.
    await db.execute(
        delete(SyncLog).where(
            (SyncLog.table_name == "sessions") & (SyncLog.record_uuid == sess.uuid)
        )
    )
    await db.commit()
    await db.refresh(sess)
    return sess


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a session, its events, and its linked recording (row + files).

    Local-only: deletions are never propagated to the server (the sync layer
    only pushes creates). Any leftover SyncLog rows are harmless — they simply
    keep the now-deleted record from being re-pushed.
    """
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")

    # Delete the linked recording too (row + files). Block if it is still being
    # written — dropping it mid-write would corrupt the MP4.
    files_to_unlink: list[str] = []
    if sess.recording_uuid:
        result = await db.execute(
            select(Recording).where(Recording.uuid == sess.recording_uuid)
        )
        rec = result.scalar_one_or_none()
        if rec is not None:
            if rec.ended_at is None:
                raise HTTPException(
                    409, "Detén la grabación antes de borrar la sesión"
                )
            files_to_unlink.append(rec.file_path)
            # Detections sidecar lives next to the MP4 (see recordings.py).
            files_to_unlink.append(
                os.path.join(os.path.dirname(rec.file_path), f"{rec.uuid}.jsonl")
            )
            await db.delete(rec)

    # Events FK the session with no cascade configured — remove them first, then
    # the session. Both are Core bulk-deletes (not db.delete(sess)) so the ORM
    # never processes the `events` relationship cascade during flush.
    await db.execute(delete(Event).where(Event.session_id == session_id))
    await db.execute(delete(Session).where(Session.id == session_id))
    await db.commit()

    for path in files_to_unlink:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

    return {"ok": True, "id": session_id}


@router.post("/sessions/save", response_model=SessionOut)
async def save_session(body: SessionSave, db: AsyncSession = Depends(get_db)):
    """Create a completed session record in the DB.

    camellon_id is optional: the session can be saved without a location and
    assigned one later (PATCH /sessions/{id})."""
    if body.camellon_id is not None:
        cam = await storage.get_camellon(db, body.camellon_id)
        if cam is None:
            raise HTTPException(404, "Camellon not found")
    sess = await storage.create_completed_session(
        db, body.camellon_id, body.target_class, body.total_count
    )
    if body.camellon_id is not None:
        await _link_recording_camellon(db, body.camellon_id)
    rec_uuid = counter.get_last_recording_uuid()
    if rec_uuid:
        sess.recording_uuid = rec_uuid
    return sess
