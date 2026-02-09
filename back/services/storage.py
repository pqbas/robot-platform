from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.models import Camellon, Event, Session


# --- Camellones ---


async def create_camellon(db: AsyncSession, nombre: str) -> Camellon:
    cam = Camellon(nombre=nombre)
    db.add(cam)
    await db.flush()
    return cam


async def list_camellones(db: AsyncSession) -> list[Camellon]:
    result = await db.execute(select(Camellon).order_by(Camellon.id))
    return list(result.scalars().all())


async def get_camellon(db: AsyncSession, camellon_id: int) -> Camellon | None:
    result = await db.execute(select(Camellon).where(Camellon.id == camellon_id))
    return result.scalar_one_or_none()


async def get_camellon_by_nombre(db: AsyncSession, nombre: str) -> Camellon | None:
    result = await db.execute(select(Camellon).where(Camellon.nombre == nombre))
    return result.scalar_one_or_none()


async def update_camellon_location(
    db: AsyncSession, camellon_id: int, lat: float, lng: float
) -> Camellon | None:
    result = await db.execute(select(Camellon).where(Camellon.id == camellon_id))
    cam = result.scalar_one_or_none()
    if cam is None:
        return None
    cam.lat = lat
    cam.lng = lng
    await db.flush()
    return cam


async def get_camellon_summary(db: AsyncSession) -> list[dict]:
    stmt = (
        select(
            Camellon.id,
            Camellon.nombre,
            func.coalesce(func.sum(Session.total_count), 0).label("total_count"),
        )
        .outerjoin(Session, Session.camellon_id == Camellon.id)
        .group_by(Camellon.id)
        .order_by(Camellon.id)
    )
    result = await db.execute(stmt)
    return [
        {"id": row.id, "nombre": row.nombre, "total_count": row.total_count}
        for row in result.all()
    ]


async def get_camellon_geo_summary(db: AsyncSession) -> list[dict]:
    stmt = (
        select(
            Camellon.id,
            Camellon.nombre,
            Camellon.lat,
            Camellon.lng,
            func.coalesce(func.sum(Session.total_count), 0).label("total_count"),
        )
        .outerjoin(Session, Session.camellon_id == Camellon.id)
        .group_by(Camellon.id)
        .order_by(Camellon.id)
    )
    result = await db.execute(stmt)
    return [
        {
            "id": row.id,
            "nombre": row.nombre,
            "lat": row.lat,
            "lng": row.lng,
            "total_count": row.total_count,
        }
        for row in result.all()
    ]


# --- Sessions ---


async def create_session(
    db: AsyncSession, camellon_id: int, target_class: str
) -> Session:
    now = datetime.now(timezone.utc).isoformat()
    sess = Session(
        camellon_id=camellon_id,
        start_time=now,
        target_class=target_class,
        total_count=0,
    )
    db.add(sess)
    await db.flush()
    return sess


async def finish_session(
    db: AsyncSession, session_id: int, total_count: int
) -> Session | None:
    result = await db.execute(select(Session).where(Session.id == session_id))
    sess = result.scalar_one_or_none()
    if sess is None:
        return None
    sess.end_time = datetime.now(timezone.utc).isoformat()
    sess.total_count = total_count
    await db.flush()
    return sess


async def list_sessions(db: AsyncSession) -> list[Session]:
    result = await db.execute(select(Session).order_by(Session.id.desc()))
    return list(result.scalars().all())


async def get_session(db: AsyncSession, session_id: int) -> Session | None:
    result = await db.execute(select(Session).where(Session.id == session_id))
    return result.scalar_one_or_none()


async def get_session_events(db: AsyncSession, session_id: int) -> list[Event]:
    result = await db.execute(
        select(Event).where(Event.session_id == session_id).order_by(Event.id)
    )
    return list(result.scalars().all())


async def save_event(
    db: AsyncSession,
    session_id: int,
    object_class: str,
    track_id: int | None = None,
) -> Event:
    now = datetime.now(timezone.utc).isoformat()
    ev = Event(
        session_id=session_id,
        timestamp=now,
        object_class=object_class,
        track_id=track_id,
    )
    db.add(ev)
    await db.flush()
    return ev
