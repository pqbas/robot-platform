"""Sync endpoints — shared between robot and server modes."""

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import (
    DetectionModel,
    Device,
    DeviceModel,
    Empresa,
    Fundo,
    Recording,
    Session,
    SyncLog,
)
from back.services.auth import get_device_or_none, verify_device_key
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
from back.services.sync_receive import (
    receive_camellones,
    receive_empresas,
    receive_events,
    receive_fundos,
    receive_locations,
    receive_recordings,
    receive_sessions,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])

# Device auth dependency — only enforced in server mode
_device_dep = [Depends(verify_device_key)] if config.mode == AppMode.SERVER else []


@router.get("/health")
async def health():
    """Health check for sync connectivity."""
    return {"status": "ok", "mode": config.mode.value}


@router.post("/pull", dependencies=_device_dep)
async def force_pull():
    """Trigger an immediate model sync pull (robot mode only)."""
    if config.mode != AppMode.ROBOT:
        return {"ok": False, "reason": "only available in robot mode"}
    from back.services.sync_pull import pull_models
    from back.services.sync_pull_context import pull_catalog, pull_device_context
    await pull_models()
    await pull_device_context()
    await pull_catalog()
    return {"ok": True}


@router.get("/catalog", dependencies=_device_dep)
async def get_catalog(db: AsyncSession = Depends(get_db)):
    """Return all empresas and fundos for catalog population on robots.

    Protected by device API key in server mode. Robots call this to
    populate their local catalog so operators can select org hierarchy
    even when offline.
    """
    empresas_result = await db.execute(select(Empresa).where(Empresa.is_active == True))  # noqa: E712
    fundos_result = await db.execute(select(Fundo).where(Fundo.is_active == True))  # noqa: E712
    empresas = empresas_result.scalars().all()
    fundos = fundos_result.scalars().all()
    return {
        "empresas": [{"uuid": e.uuid, "name": e.name} for e in empresas],
        "fundos": [
            {
                "uuid": f.uuid,
                "empresa_uuid": f.empresa_uuid,
                "name": f.name,
                "region": f.region,
            }
            for f in fundos
        ],
    }


@router.post("/push", dependencies=_device_dep)
async def force_push(db: AsyncSession = Depends(get_db)):
    """Trigger an immediate sync push of unsynced records (robot mode only)."""
    if config.mode != AppMode.ROBOT:
        return {"ok": False, "reason": "only available in robot mode"}
    from back.services.sync_push import push_all
    await push_all(db)
    return {"ok": True}


@router.post("/sessions/{session_id}/push", dependencies=_device_dep)
async def push_session_now(session_id: int, db: AsyncSession = Depends(get_db)):
    """Force an immediate sync of one session: metadata + its MP4 (robot only).

    Reuses the regular push pipeline (idempotent — only unsynced rows leave)
    and then uploads just this session's recording blob. Never raises on a
    connectivity failure: returns ``metadata``/``mp4`` status so the UI can
    say "metadata enviada, MP4 pendiente" and let the loop retry.
    """
    if config.mode != AppMode.ROBOT:
        return {"ok": False, "reason": "solo disponible en modo robot"}

    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    from back.services.sync_push import push_all
    from back.services.sync_recordings_upload import upload_single_recording

    # The button means "send everything for this session now". Sync is
    # insert-only, but the count (on the session) and count_config (on the
    # recording) are computed after the first sync — so drop both sync_log rows
    # to force a fresh re-push with the current values (the server upserts).
    await db.execute(
        delete(SyncLog).where(
            (SyncLog.table_name == "sessions") & (SyncLog.record_uuid == session.uuid)
        )
    )
    if session.recording_uuid:
        await db.execute(
            delete(SyncLog).where(
                (SyncLog.table_name == "recordings")
                & (SyncLog.record_uuid == session.recording_uuid)
            )
        )
    await db.commit()

    await push_all(db)

    # push_all is silent on failure → confirm the row actually landed.
    synced = await db.execute(
        select(SyncLog).where(
            (SyncLog.table_name == "sessions") & (SyncLog.record_uuid == session.uuid)
        )
    )
    metadata = "ok" if synced.scalar_one_or_none() is not None else "pending"

    mp4 = "none"
    if session.recording_uuid:
        mp4 = await upload_single_recording(db, session.recording_uuid)

    return {"ok": metadata == "ok", "metadata": metadata, "mp4": mp4}


@router.post("/recordings/{uuid}/push", dependencies=_device_dep)
async def push_recording_now(uuid: str, db: AsyncSession = Depends(get_db)):
    """Force an immediate sync of one recording: metadata + its MP4 (robot only).

    Same shape as :func:`push_session_now` but keyed by recording uuid, for the
    Grabaciones list. Idempotent and connectivity-safe — reports status instead
    of raising so the UI can say "metadata enviada, MP4 pendiente".
    """
    if config.mode != AppMode.ROBOT:
        return {"ok": False, "reason": "solo disponible en modo robot"}

    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    from back.services.sync_push import push_all
    from back.services.sync_recordings_upload import upload_single_recording

    await push_all(db)

    synced = await db.execute(
        select(SyncLog).where(
            (SyncLog.table_name == "recordings") & (SyncLog.record_uuid == uuid)
        )
    )
    metadata = "ok" if synced.scalar_one_or_none() is not None else "pending"

    mp4 = await upload_single_recording(db, uuid)

    return {"ok": metadata == "ok", "metadata": metadata, "mp4": mp4}


# --- Receive endpoints (server mode, protected by device API key) ---


@router.post("/empresas", response_model=SyncResult, dependencies=_device_dep)
async def sync_empresas(items: list[SyncEmpresa], db: AsyncSession = Depends(get_db)):
    return await receive_empresas(db, items)


@router.post("/fundos", response_model=SyncResult, dependencies=_device_dep)
async def sync_fundos(items: list[SyncFundo], db: AsyncSession = Depends(get_db)):
    return await receive_fundos(db, items)


@router.post("/locations", response_model=SyncResult, dependencies=_device_dep)
async def sync_locations(items: list[SyncLocation], db: AsyncSession = Depends(get_db)):
    return await receive_locations(db, items)


@router.post("/camellones", response_model=SyncResult, dependencies=_device_dep)
async def sync_camellones(items: list[SyncCamellon], db: AsyncSession = Depends(get_db)):
    return await receive_camellones(db, items)


@router.post("/sessions", response_model=SyncResult, dependencies=_device_dep)
async def sync_sessions(items: list[SyncSession], db: AsyncSession = Depends(get_db)):
    return await receive_sessions(db, items)


@router.post("/events", response_model=SyncResult, dependencies=_device_dep)
async def sync_events(items: list[SyncEvent], db: AsyncSession = Depends(get_db)):
    return await receive_events(db, items)


if config.mode == AppMode.SERVER:

    @router.post("/recordings", response_model=SyncResult)
    async def sync_recordings(
        items: list[SyncRecording],
        db: AsyncSession = Depends(get_db),
        device: Device = Depends(verify_device_key),
    ):
        return await receive_recordings(db, items, device.id)

else:

    @router.post("/recordings", response_model=SyncResult)
    async def sync_recordings(
        items: list[SyncRecording], db: AsyncSession = Depends(get_db)
    ):
        # Robot mode: not normally hit, but kept for symmetry; trust the
        # incoming device_id (callers in robot mode are local).
        device_id = items[0].device_id if items and items[0].device_id else "unknown"
        return await receive_recordings(db, items, device_id)


# --- Model endpoints (protected by device API key in server mode) ---


@router.get("/models")
async def list_models(db: AsyncSession = Depends(get_db), device: Device | None = Depends(get_device_or_none)):
    """List detection models for the requesting device.

    Server mode: returns only models assigned to the device via device_models.
    Robot mode: returns all active models (no auth, no filtering).
    """
    if device is not None:
        device.last_sync_at = datetime.now(timezone.utc).isoformat()
        stmt = (
            select(DetectionModel)
            .join(DeviceModel, DeviceModel.model_uuid == DetectionModel.uuid)
            .where(DeviceModel.device_id == device.id)
        )
    else:
        stmt = select(DetectionModel).where(DetectionModel.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    models = result.scalars().all()
    return [
        {
            "uuid": m.uuid,
            "filename": m.filename,
            "file_hash": m.file_hash,
            "source": m.source,
            "version": m.version,
            "class_mapping": m.class_mapping,
            "notes": m.notes,
        }
        for m in models
    ]


@router.get("/device-context")
async def device_context(
    db: AsyncSession = Depends(get_db),
    device: Device | None = Depends(get_device_or_none),
):
    """Return the empresa+fundo associated with the requesting device.

    Server mode: requires device API key. Resolves the join.
    Robot mode: returns nulls (lab default — used when running unauthenticated).
    """
    if config.mode == AppMode.SERVER and device is None:
        raise HTTPException(status_code=401, detail="device key required")

    if device is None:
        from back.config import get_device_id
        return {
            "device_id": get_device_id(),
            "empresa": None,
            "fundo": None,
        }

    device.last_sync_at = datetime.now(timezone.utc).isoformat()

    if not device.fundo_uuid:
        await db.commit()
        return {"device_id": device.id, "empresa": None, "fundo": None}

    fundo_result = await db.execute(
        select(Fundo).where(Fundo.uuid == device.fundo_uuid)
    )
    fundo = fundo_result.scalar_one_or_none()
    if not fundo:
        await db.commit()
        return {"device_id": device.id, "empresa": None, "fundo": None}

    empresa_result = await db.execute(
        select(Empresa).where(Empresa.uuid == fundo.empresa_uuid)
    )
    empresa = empresa_result.scalar_one_or_none()
    await db.commit()
    return {
        "device_id": device.id,
        "empresa": (
            {"uuid": empresa.uuid, "name": empresa.name} if empresa else None
        ),
        "fundo": {"uuid": fundo.uuid, "name": fundo.name, "region": fundo.region},
    }


@router.get("/models/{model_uuid}", dependencies=_device_dep)
async def download_model(model_uuid: str, db: AsyncSession = Depends(get_db)):
    """Download a model .pt file by UUID."""
    result = await db.execute(
        select(DetectionModel).where(DetectionModel.uuid == model_uuid)
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    file_path = Path(config.storage.models_dir) / model.filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=model.filename,
        media_type="application/octet-stream",
    )


# --- Recording blob upload (server only) ---


if config.mode == AppMode.SERVER:

    @router.post("/recordings/{uuid}/upload")
    async def upload_recording_blob(
        uuid: str,
        file: UploadFile = File(...),
        db: AsyncSession = Depends(get_db),
        device: Device = Depends(verify_device_key),
    ):
        result = await db.execute(select(Recording).where(Recording.uuid == uuid))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, "Recording not found")
        if row.device_id != device.id:
            raise HTTPException(404, "Recording not found")
        if row.uploaded_at is not None:
            raise HTTPException(409, "Recording already uploaded")

        os.makedirs(config.storage.recordings_dir, exist_ok=True)
        out_path = os.path.join(config.storage.recordings_dir, f"{uuid}.mp4")

        size = 0
        with open(out_path, "wb") as out:
            while chunk := await file.read(1_048_576):
                out.write(chunk)
                size += len(chunk)

        row.uploaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        row.file_path = out_path
        row.file_size_bytes = size
        await db.commit()
        return {"ok": True, "uuid": uuid, "size_bytes": size}

    @router.post("/recordings/{uuid}/detections/upload")
    async def upload_recording_detections(
        uuid: str,
        file: UploadFile = File(...),
        db: AsyncSession = Depends(get_db),
        device: Device = Depends(verify_device_key),
    ):
        result = await db.execute(select(Recording).where(Recording.uuid == uuid))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(404, "Recording not found")
        if row.device_id != device.id:
            raise HTTPException(404, "Recording not found")

        os.makedirs(config.storage.recordings_dir, exist_ok=True)
        out_path = os.path.join(config.storage.recordings_dir, f"{uuid}.jsonl")

        size = 0
        with open(out_path, "wb") as out:
            while chunk := await file.read(1_048_576):
                out.write(chunk)
                size += len(chunk)
        return {"ok": True, "uuid": uuid, "size_bytes": size}
