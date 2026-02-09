import csv
import io
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.schemas import (
    CountingStartRequest,
    CountingStatusOut,
    CountingStopOut,
    EventOut,
    SessionOut,
    SessionSave,
)
from back.services import storage
from back.services.perception import counter

logger = logging.getLogger("counting")

router = APIRouter(prefix="/api", tags=["sessions"])


# --- Live counting (in-memory, no DB) ---


@router.post("/counting/start", response_model=CountingStatusOut)
async def start_counting(body: CountingStartRequest):
    if counter.is_session_active():
        raise HTTPException(409, "Counting is already active")
    counter.start_counting(body.target_class)
    return CountingStatusOut(active=True, target_class=body.target_class)


@router.post("/counting/stop", response_model=CountingStopOut)
async def stop_counting():
    if not counter.is_session_active():
        raise HTTPException(409, "No counting is active")
    total_count, target_class = counter.stop_counting()
    return CountingStopOut(total_count=total_count, target_class=target_class)


# --- Sessions (DB persistence) ---


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    return await storage.list_sessions(db, date_from, date_to)


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


@router.post("/sessions/save", response_model=SessionOut)
async def save_session(body: SessionSave, db: AsyncSession = Depends(get_db)):
    """Create a completed session record in the DB."""
    cam = await storage.get_camellon(db, body.camellon_id)
    if cam is None:
        raise HTTPException(404, "Camellon not found")
    sess = await storage.create_completed_session(
        db, body.camellon_id, body.target_class, body.total_count
    )
    return sess
