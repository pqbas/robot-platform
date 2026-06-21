import json
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from back.models import (
    Camellon,
    Category,
    ClassificationModel,
    Event,
    Fundo,
    Location,
    Recording,
    Session,
    _now_iso,
)


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


async def create_camellon(
    db: AsyncSession, nombre: str, fundo_uuid: str | None = None
) -> Camellon:
    cam = Camellon(nombre=nombre, fundo_uuid=fundo_uuid)
    db.add(cam)
    await db.flush()
    return cam


def _scope_by_fundo(stmt, fundo_uuid: str | None):
    """Restrict a Camellon query to a single fundo. `None` matches the rows
    with no fundo assigned (legacy / unconfigured robot) — mirroring how
    create_camellon stamps the current fundo (or None) onto new rows."""
    if fundo_uuid is None:
        return stmt.where(Camellon.fundo_uuid.is_(None))
    return stmt.where(Camellon.fundo_uuid == fundo_uuid)


async def list_camellones(
    db: AsyncSession,
    *,
    scope_fundo: bool = False,
    fundo_uuid: str | None = None,
) -> list[Camellon]:
    # Eager-load the fundo → empresa chain so callers can resolve the location
    # hierarchy (empresa / fundo / camellon) without per-row lazy IO in async.
    stmt = (
        select(Camellon)
        .options(selectinload(Camellon.fundo).selectinload(Fundo.empresa))
        .order_by(Camellon.id)
    )
    if scope_fundo:
        stmt = _scope_by_fundo(stmt, fundo_uuid)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_camellon(db: AsyncSession, camellon_id: int) -> Camellon | None:
    result = await db.execute(select(Camellon).where(Camellon.id == camellon_id))
    return result.scalar_one_or_none()


async def get_camellon_by_nombre(
    db: AsyncSession,
    nombre: str,
    *,
    scope_fundo: bool = False,
    fundo_uuid: str | None = None,
) -> Camellon | None:
    stmt = select(Camellon).where(Camellon.nombre == nombre)
    if scope_fundo:
        stmt = _scope_by_fundo(stmt, fundo_uuid)
    result = await db.execute(stmt)
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
    db: AsyncSession, camellon_id: int | None, target_class: str, total_count: int
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


async def _attach_count_status(
    db: AsyncSession, sessions: list[Session]
) -> None:
    """Set transient fields on each session from its linked recording (the
    offline counting state, plus duration/size/upload status, live on the
    Recording — the video is the source of truth — not the Session).
    Non-mapped attributes read by SessionOut's from_attributes."""
    uuids = [s.recording_uuid for s in sessions if s.recording_uuid]
    by_uuid: dict[str, Recording] = {}
    if uuids:
        rows = await db.execute(
            select(Recording).where(Recording.uuid.in_(uuids))
        )
        by_uuid = {r.uuid: r for r in rows.scalars().all()}
    for s in sessions:
        rec = by_uuid.get(s.recording_uuid) if s.recording_uuid else None
        s.count_status = rec.count_status if rec else "none"
        s.count = rec.count if rec else None
        s.duration_seconds = rec.duration_seconds if rec else None
        s.file_size_bytes = rec.file_size_bytes if rec else None
        s.uploaded_at = rec.uploaded_at if rec else None


async def list_sessions(
    db: AsyncSession,
    date_from: date | None = None,
    date_to: date | None = None,
    device_id: str | None = None,
) -> list[Session]:
    stmt = select(Session)
    if date_from:
        stmt = stmt.where(Session.start_time >= date_from.isoformat())
    if date_to:
        stmt = stmt.where(Session.start_time <= date_to.isoformat() + "T23:59:59")
    if device_id:
        stmt = stmt.where(Session.device_id == device_id)
    stmt = stmt.order_by(Session.id.desc())
    result = await db.execute(stmt)
    sessions = list(result.scalars().all())
    await _attach_count_status(db, sessions)
    return sessions


async def list_session_devices(db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(Session.device_id).distinct().order_by(Session.device_id)
    )
    return [row[0] for row in result.all() if row[0]]


async def get_session(db: AsyncSession, session_id: int) -> Session | None:
    result = await db.execute(select(Session).where(Session.id == session_id))
    sess = result.scalar_one_or_none()
    if sess is not None:
        await _attach_count_status(db, [sess])
    return sess


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


# --- Dashboard ---


async def get_dashboard_stats(
    db: AsyncSession,
    date_from: date | None = None,
    date_to: date | None = None,
    target_class: str | None = None,
    camellon_id: int | None = None,
    device_id: str | None = None,
) -> dict:
    """Return KPIs + trend + breakdowns for the dashboard."""

    # Base filter applied to all queries
    def _apply_filters(stmt):  # noqa: ANN001, ANN202
        if date_from:
            stmt = stmt.where(Session.start_time >= date_from.isoformat())
        if date_to:
            stmt = stmt.where(Session.start_time <= date_to.isoformat() + "T23:59:59")
        if target_class:
            stmt = stmt.where(Session.target_class == target_class)
        if camellon_id:
            stmt = stmt.where(Session.camellon_id == camellon_id)
        if device_id:
            stmt = stmt.where(Session.device_id == device_id)
        return stmt

    # 1) KPIs
    kpi_stmt = _apply_filters(
        select(
            func.coalesce(func.sum(Session.total_count), 0).label("total_count"),
            func.count(Session.id).label("session_count"),
            func.count(func.distinct(Session.camellon_id)).label("camellon_count"),
        )
    )
    kpi_row = (await db.execute(kpi_stmt)).one()
    avg = (
        round(kpi_row.total_count / kpi_row.session_count, 1)
        if kpi_row.session_count
        else 0.0
    )

    # 2) Daily trend (aggregate by date substring of start_time)
    date_col = func.substr(Session.start_time, 1, 10).label("date")
    trend_stmt = _apply_filters(
        select(date_col, func.sum(Session.total_count).label("count"))
        .group_by(date_col)
        .order_by(date_col)
    )
    trend_rows = (await db.execute(trend_stmt)).all()

    # 3) By camellon
    cam_stmt = _apply_filters(
        select(
            Camellon.id.label("camellon_id"),
            Camellon.nombre,
            func.coalesce(func.sum(Session.total_count), 0).label("count"),
        )
        .join(Camellon, Session.camellon_id == Camellon.id)
        .group_by(Camellon.id)
        .order_by(func.sum(Session.total_count).desc())
    )
    cam_rows = (await db.execute(cam_stmt)).all()

    # 4) By class
    cls_stmt = _apply_filters(
        select(
            Session.target_class,
            func.sum(Session.total_count).label("count"),
        )
        .group_by(Session.target_class)
        .order_by(func.sum(Session.total_count).desc())
    )
    cls_rows = (await db.execute(cls_stmt)).all()

    return {
        "kpis": {
            "total_count": kpi_row.total_count,
            "session_count": kpi_row.session_count,
            "camellon_count": kpi_row.camellon_count,
            "avg_per_session": avg,
        },
        "daily_trend": [
            {"date": r.date, "count": r.count} for r in trend_rows
        ],
        "by_camellon": [
            {"camellon_id": r.camellon_id, "nombre": r.nombre, "count": r.count}
            for r in cam_rows
        ],
        "by_class": [
            {"target_class": r.target_class, "count": r.count} for r in cls_rows
        ],
    }


# --- Categories (the deployment hub) ---

_CATEGORY_GEOMETRY = (
    "method",
    "count_mode",
    "threshold",
    "direction",
    "roi_mode",
    "confidence",
)


async def list_categories(db: AsyncSession) -> list[Category]:
    result = await db.execute(select(Category).order_by(Category.name))
    return list(result.scalars().all())


async def get_category(db: AsyncSession, name: str) -> Category | None:
    result = await db.execute(select(Category).where(Category.name == name))
    return result.scalar_one_or_none()


async def create_category(
    db: AsyncSession,
    name: str,
    *,
    detection_model_uuid: str | None = None,
    classification_model_uuid: str | None = None,
    **geometry,
) -> Category:
    cat = Category(
        name=name,
        detection_model_uuid=detection_model_uuid,
        classification_model_uuid=classification_model_uuid,
        updated_at=_now_iso(),
    )
    for key in _CATEGORY_GEOMETRY:
        if geometry.get(key) is not None:
            setattr(cat, key, geometry[key])
    db.add(cat)
    await db.flush()
    return cat


async def update_category(db: AsyncSession, name: str, **fields) -> Category | None:
    """Update a category's detector / classifier / geometry.

    Only keys present (non-None) are applied, except ``classification_model_uuid``
    which accepts an explicit ``None`` to *clear* the classifier — pass the
    ``clear_classifier=True`` flag to do so unambiguously.
    """
    cat = await get_category(db, name)
    if cat is None:
        return None
    if fields.pop("clear_classifier", False):
        cat.classification_model_uuid = None
    if fields.get("detection_model_uuid") is not None:
        cat.detection_model_uuid = fields["detection_model_uuid"]
    if fields.get("classification_model_uuid") is not None:
        cat.classification_model_uuid = fields["classification_model_uuid"]
    for key in _CATEGORY_GEOMETRY:
        if fields.get(key) is not None:
            setattr(cat, key, fields[key])
    cat.updated_at = _now_iso()
    await db.flush()
    return cat


async def delete_category(db: AsyncSession, name: str) -> bool:
    cat = await get_category(db, name)
    if cat is None:
        return False
    await db.delete(cat)
    await db.flush()
    return True


# --- Classification models (the classifier library) ---


async def list_classification_models(db: AsyncSession) -> list[ClassificationModel]:
    result = await db.execute(
        select(ClassificationModel).order_by(ClassificationModel.created_at)
    )
    return list(result.scalars().all())


async def get_classification_model(
    db: AsyncSession, uuid: str
) -> ClassificationModel | None:
    result = await db.execute(
        select(ClassificationModel).where(ClassificationModel.uuid == uuid)
    )
    return result.scalar_one_or_none()


async def get_classification_model_by_hash(
    db: AsyncSession, file_hash: str
) -> ClassificationModel | None:
    result = await db.execute(
        select(ClassificationModel).where(
            ClassificationModel.file_hash == file_hash
        )
    )
    return result.scalar_one_or_none()


async def create_classification_model(
    db: AsyncSession,
    *,
    version: str,
    filename: str,
    file_hash: str | None,
    class_names: list[str],
    num_classes: int | None = None,
    latent_dim: int = 128,
    imgsz: int = 128,
    source: str = "uploaded",
    uuid: str | None = None,
) -> ClassificationModel:
    model = ClassificationModel(
        version=version,
        filename=filename,
        file_hash=file_hash,
        source=source,
        class_names=json.dumps(class_names),
        num_classes=num_classes if num_classes is not None else len(class_names),
        latent_dim=latent_dim,
        imgsz=imgsz,
        created_at=_now_iso(),
    )
    if uuid is not None:
        model.uuid = uuid
    db.add(model)
    await db.flush()
    return model


async def delete_classification_model(db: AsyncSession, uuid: str) -> bool:
    model = await get_classification_model(db, uuid)
    if model is None:
        return False
    await db.delete(model)
    await db.flush()
    return True
