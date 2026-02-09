import csv
import io
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.schemas import EventOut, SessionOut, SessionStart, SessionStopOut
from back.services import storage
from back.services.perception import counter

logger = logging.getLogger("counting")

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    return await storage.list_sessions(db)


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    return sess


@router.get("/{session_id}/events", response_model=list[EventOut])
async def get_session_events(session_id: int, db: AsyncSession = Depends(get_db)):
    sess = await storage.get_session(db, session_id)
    if sess is None:
        raise HTTPException(404, "Session not found")
    return await storage.get_session_events(db, session_id)


@router.get("/{session_id}/export")
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


@router.post("/start", response_model=SessionOut)
async def start_session(body: SessionStart, db: AsyncSession = Depends(get_db)):
    if counter.is_session_active():
        raise HTTPException(409, "A counting session is already active")

    cam = await storage.get_camellon(db, body.camellon_id)
    if cam is None:
        raise HTTPException(404, "Camellon not found")

    sess = await storage.create_session(db, body.camellon_id, body.target_class)
    counter.start_session(sess.id, body.camellon_id, body.target_class)
    return sess


@router.post("/stop", response_model=SessionStopOut)
async def stop_session(db: AsyncSession = Depends(get_db)):
    if not counter.is_session_active():
        raise HTTPException(409, "No counting session is active")

    session_id, total_count = counter.stop_session()
    sess = await storage.finish_session(db, session_id, total_count)
    if sess is None:
        raise HTTPException(500, "Session record not found in database")
    return SessionStopOut(
        id=sess.id,
        total_count=sess.total_count,
        end_time=sess.end_time,
    )
