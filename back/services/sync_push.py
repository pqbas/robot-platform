"""Robot-side sync push — sends unsynced records to the server."""

import logging

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.models import (
    Camellon,
    Empresa,
    Event,
    Fundo,
    Location,
    Session,
    SyncLog,
)

logger = logging.getLogger(__name__)


async def _get_unsynced_uuids(db: AsyncSession, table_name: str, model_class: type) -> list:
    """Get records from model_class whose uuid is not in sync_log."""
    synced = await db.execute(
        select(SyncLog.record_uuid).where(SyncLog.table_name == table_name)
    )
    synced_uuids = {row[0] for row in synced.fetchall()}

    all_records = await db.execute(select(model_class))
    records = all_records.scalars().all()

    return [r for r in records if r.uuid not in synced_uuids]


async def _mark_synced(db: AsyncSession, table_name: str, uuids: list[str]) -> None:
    """Mark records as synced in sync_log."""
    for uuid in uuids:
        db.add(SyncLog(table_name=table_name, record_uuid=uuid))
    await db.commit()


async def _post_batch(session: aiohttp.ClientSession, endpoint: str, data: list[dict]) -> dict | None:
    """POST a batch of records to the server sync endpoint."""
    if not data:
        return None
    url = f"{config.sync.server_url}/api/sync/{endpoint}"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}
    try:
        async with session.post(url, json=data, headers=headers) as resp:
            if resp.status == 200:
                result = await resp.json()
                logger.info(
                    "Sync push %s: received=%d inserted=%d skipped=%d",
                    endpoint, result["received"], result["inserted"], result["skipped"],
                )
                return result
            logger.warning("Sync push %s: server returned %d", endpoint, resp.status)
            return None
    except Exception as exc:
        logger.warning("Sync push %s failed: %s", endpoint, exc)
        return None


async def push_all(db: AsyncSession) -> None:
    """Push all unsynced records to the server in dependency order."""
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as http:
        # 1. Empresas
        unsynced = await _get_unsynced_uuids(db, "empresas", Empresa)
        if unsynced:
            data = [{"uuid": r.uuid, "name": r.name, "is_active": r.is_active, "created_at": r.created_at} for r in unsynced]
            result = await _post_batch(http, "empresas", data)
            if result:
                await _mark_synced(db, "empresas", [r.uuid for r in unsynced])

        # 2. Fundos
        unsynced = await _get_unsynced_uuids(db, "fundos", Fundo)
        if unsynced:
            data = [{
                "uuid": r.uuid, "empresa_uuid": r.empresa_uuid,
                "name": r.name, "region": r.region,
                "is_active": r.is_active, "created_at": r.created_at,
            } for r in unsynced]
            result = await _post_batch(http, "fundos", data)
            if result:
                await _mark_synced(db, "fundos", [r.uuid for r in unsynced])

        # 4. Locations
        unsynced = await _get_unsynced_uuids(db, "locations", Location)
        if unsynced:
            data = [{
                "uuid": r.uuid, "device_id": r.device_id, "label": r.label,
                "lat": r.lat, "lng": r.lng, "zoom": r.zoom, "polygon": r.polygon,
            } for r in unsynced]
            result = await _post_batch(http, "locations", data)
            if result:
                await _mark_synced(db, "locations", [r.uuid for r in unsynced])

        # 5. Camellones
        unsynced = await _get_unsynced_uuids(db, "camellones", Camellon)
        if unsynced:
            data = [{
                "uuid": r.uuid, "device_id": r.device_id, "fundo_uuid": r.fundo_uuid,
                "nombre": r.nombre, "lat": r.lat, "lng": r.lng,
            } for r in unsynced]
            result = await _post_batch(http, "camellones", data)
            if result:
                await _mark_synced(db, "camellones", [r.uuid for r in unsynced])

        # 6. Sessions (resolve camellon_id → camellon_uuid)
        unsynced = await _get_unsynced_uuids(db, "sessions", Session)
        if unsynced:
            data = []
            for r in unsynced:
                # Get camellon uuid
                cam = await db.execute(select(Camellon).where(Camellon.id == r.camellon_id))
                camellon = cam.scalar_one_or_none()
                if not camellon:
                    logger.warning("Session %s: camellon_id %d not found, skipping", r.uuid, r.camellon_id)
                    continue
                data.append({
                    "uuid": r.uuid, "device_id": r.device_id,
                    "camellon_uuid": camellon.uuid,
                    "start_time": r.start_time, "end_time": r.end_time,
                    "target_class": r.target_class, "total_count": r.total_count,
                })
            result = await _post_batch(http, "sessions", data)
            if result:
                await _mark_synced(db, "sessions", [r.uuid for r in unsynced])

        # 7. Events (resolve session_id → session_uuid)
        unsynced = await _get_unsynced_uuids(db, "events", Event)
        if unsynced:
            data = []
            for r in unsynced:
                sess = await db.execute(select(Session).where(Session.id == r.session_id))
                session = sess.scalar_one_or_none()
                if not session:
                    logger.warning("Event %s: session_id %d not found, skipping", r.uuid, r.session_id)
                    continue
                data.append({
                    "uuid": r.uuid, "device_id": r.device_id,
                    "session_uuid": session.uuid,
                    "timestamp": r.timestamp, "object_class": r.object_class,
                    "track_id": r.track_id,
                })
            result = await _post_batch(http, "events", data)
            if result:
                await _mark_synced(db, "events", [r.uuid for r in unsynced])
