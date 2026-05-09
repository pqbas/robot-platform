"""Sync endpoints — shared between robot and server modes."""

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import DetectionModel, Device, DeviceModel, Empresa, Fundo, Recording
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
    from back.services.sync_pull_context import pull_device_context
    await pull_models()
    await pull_device_context()
    return {"ok": True}


@router.post("/push", dependencies=_device_dep)
async def force_push(db: AsyncSession = Depends(get_db)):
    """Trigger an immediate sync push of unsynced records (robot mode only)."""
    if config.mode != AppMode.ROBOT:
        return {"ok": False, "reason": "only available in robot mode"}
    from back.services.sync_push import push_all
    await push_all(db)
    return {"ok": True}


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
