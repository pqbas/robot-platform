import json
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.models import Camellon, Event, Location, Session


# --- Locations ---


def _polygon_centroid(polygon: list[dict]) -> tuple[float, float]:
    """Return (lat, lng) centroid of a polygon."""
    n = len(polygon)
    lat = sum(p["lat"] for p in polygon) / n
    lng = sum(p["lng"] for p in polygon) / n
    return lat, lng


async def list_locations(db: AsyncSession) -> list[Location]:
    result = await db.execute(select(Location).order_by(Location.id))
    return list(result.scalars().all())


async def create_location(
    db: AsyncSession,
    label: str,
    lat: float,
    lng: float,
    zoom: int = 17,
    polygon: list[dict] | None = None,
) -> Location:
    if polygon and len(polygon) >= 3:
        lat, lng = _polygon_centroid(polygon)
    loc = Location(
        label=label,
        lat=lat,
        lng=lng,
        zoom=zoom,
        polygon=json.dumps(polygon) if polygon else None,
    )
    db.add(loc)
    await db.flush()
    return loc


async def update_location_polygon(
    db: AsyncSession, location_id: int, polygon: list[dict] | None
) -> Location | None:
    result = await db.execute(select(Location).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if loc is None:
        return None
    loc.polygon = json.dumps(polygon) if polygon else None
    if polygon and len(polygon) >= 3:
        loc.lat, loc.lng = _polygon_centroid(polygon)
    await db.flush()
    return loc


async def delete_location(db: AsyncSession, location_id: int) -> bool:
    result = await db.execute(select(Location).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if loc is None:
        return False
    await db.delete(loc)
    await db.flush()
    return True


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


async def create_completed_session(
    db: AsyncSession, camellon_id: int, target_class: str, total_count: int
) -> Session:
    """Create a session that is already finished (start_time == end_time)."""
    now = datetime.now(timezone.utc).isoformat()
    sess = Session(
        camellon_id=camellon_id,
        start_time=now,
        end_time=now,
        target_class=target_class,
        total_count=total_count,
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


async def list_sessions(
    db: AsyncSession,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[Session]:
    stmt = select(Session)
    if date_from:
        stmt = stmt.where(Session.start_time >= date_from.isoformat())
    if date_to:
        stmt = stmt.where(Session.start_time <= date_to.isoformat() + "T23:59:59")
    stmt = stmt.order_by(Session.id.desc())
    result = await db.execute(stmt)
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
