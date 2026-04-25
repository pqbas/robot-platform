"""Server-side sync ingest — receives data from robots, deduplicates by UUID."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.models import (
    Camellon,
    Empresa,
    Event,
    Fundo,
    Location,
    Recording,
    Session,
)
from back.schemas import (
    SyncCamellon,
    SyncEmpresa,
    SyncEvent,
    SyncFundo,
    SyncLocation,
    SyncRecording,
    SyncResult,
    SyncSession,
)

logger = logging.getLogger(__name__)


async def receive_empresas(db: AsyncSession, items: list[SyncEmpresa]) -> SyncResult:
    inserted = 0
    skipped = 0
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Empresa).where(Empresa.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        db.add(Empresa(uuid=item.uuid, name=item.name, is_active=item.is_active, created_at=item.created_at))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, successful_uuids=ok)


async def receive_fundos(db: AsyncSession, items: list[SyncFundo]) -> SyncResult:
    inserted = 0
    skipped = 0
    errors: list[str] = []
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Fundo).where(Fundo.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        # Verify empresa exists
        emp = await db.execute(select(Empresa).where(Empresa.uuid == item.empresa_uuid))
        if not emp.scalar_one_or_none():
            errors.append(f"empresa_uuid {item.empresa_uuid} not found for fundo {item.uuid}")
            continue
        db.add(Fundo(
            uuid=item.uuid, empresa_uuid=item.empresa_uuid,
            name=item.name, region=item.region,
            is_active=item.is_active, created_at=item.created_at,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, errors=errors, successful_uuids=ok)


async def receive_locations(db: AsyncSession, items: list[SyncLocation]) -> SyncResult:
    inserted = 0
    skipped = 0
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Location).where(Location.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        db.add(Location(
            uuid=item.uuid, device_id=item.device_id, label=item.label,
            lat=item.lat, lng=item.lng, zoom=item.zoom, polygon=item.polygon,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, successful_uuids=ok)


async def receive_camellones(db: AsyncSession, items: list[SyncCamellon]) -> SyncResult:
    inserted = 0
    skipped = 0
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Camellon).where(Camellon.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        db.add(Camellon(
            uuid=item.uuid, device_id=item.device_id, fundo_uuid=item.fundo_uuid,
            nombre=item.nombre, lat=item.lat, lng=item.lng,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, successful_uuids=ok)


async def receive_sessions(db: AsyncSession, items: list[SyncSession]) -> SyncResult:
    inserted = 0
    skipped = 0
    errors: list[str] = []
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Session).where(Session.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        # Resolve camellon_uuid → camellon_id
        cam = await db.execute(select(Camellon).where(Camellon.uuid == item.camellon_uuid))
        camellon = cam.scalar_one_or_none()
        if not camellon:
            errors.append(f"camellon_uuid {item.camellon_uuid} not found for session {item.uuid}")
            continue
        db.add(Session(
            uuid=item.uuid, device_id=item.device_id, camellon_id=camellon.id,
            start_time=item.start_time, end_time=item.end_time,
            target_class=item.target_class, total_count=item.total_count,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, errors=errors, successful_uuids=ok)


async def receive_events(db: AsyncSession, items: list[SyncEvent]) -> SyncResult:
    inserted = 0
    skipped = 0
    errors: list[str] = []
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Event).where(Event.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        # Resolve session_uuid → session_id
        sess = await db.execute(select(Session).where(Session.uuid == item.session_uuid))
        session = sess.scalar_one_or_none()
        if not session:
            errors.append(f"session_uuid {item.session_uuid} not found for event {item.uuid}")
            continue
        db.add(Event(
            uuid=item.uuid, device_id=item.device_id, session_id=session.id,
            timestamp=item.timestamp, object_class=item.object_class,
            track_id=item.track_id,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(received=len(items), inserted=inserted, skipped=skipped, errors=errors, successful_uuids=ok)


async def receive_recordings(
    db: AsyncSession, items: list[SyncRecording], device_id: str
) -> SyncResult:
    """Ingest recording metadata. session_uuid is informational — do not
    reject if it doesn't resolve on this server (the session may not have
    been synced yet, or may be a robot-only recording with session_uuid=null).
    The blob is uploaded separately via /api/sync/recordings/{uuid}/upload.
    """
    inserted = 0
    skipped = 0
    errors: list[str] = []
    ok: list[str] = []
    for item in items:
        existing = await db.execute(select(Recording).where(Recording.uuid == item.uuid))
        if existing.scalar_one_or_none():
            skipped += 1
            ok.append(item.uuid)
            continue
        # Trust the device_id from the authenticated device, not the payload
        # (defence in depth — robots could otherwise spoof another device).
        db.add(Recording(
            uuid=item.uuid,
            device_id=device_id,
            session_uuid=item.session_uuid,
            started_at=item.started_at,
            ended_at=item.ended_at,
            duration_seconds=item.duration_seconds,
            file_path=item.file_path,
            file_size_bytes=item.file_size_bytes,
            width=item.width,
            height=item.height,
            fps=item.fps,
        ))
        inserted += 1
        ok.append(item.uuid)
    await db.commit()
    return SyncResult(
        received=len(items),
        inserted=inserted,
        skipped=skipped,
        errors=errors,
        successful_uuids=ok,
    )
