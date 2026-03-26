"""Sync endpoints — shared between robot and server modes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import DetectionModel
from back.services.auth import verify_device_key
from back.schemas import (
    SyncCamellon,
    SyncEmpresa,
    SyncEvent,
    SyncFruitType,
    SyncFundo,
    SyncLocation,
    SyncResult,
    SyncSession,
)
from back.services.sync_receive import (
    receive_camellones,
    receive_empresas,
    receive_events,
    receive_fruit_types,
    receive_fundos,
    receive_locations,
    receive_sessions,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])

# Device auth dependency — only enforced in server mode
_device_dep = [Depends(verify_device_key)] if config.mode == AppMode.SERVER else []


@router.get("/health")
async def health():
    """Health check for sync connectivity."""
    return {"status": "ok", "mode": config.mode.value}


# --- Receive endpoints (server mode, protected by device API key) ---


@router.post("/empresas", response_model=SyncResult, dependencies=_device_dep)
async def sync_empresas(items: list[SyncEmpresa], db: AsyncSession = Depends(get_db)):
    return await receive_empresas(db, items)


@router.post("/fruit-types", response_model=SyncResult, dependencies=_device_dep)
async def sync_fruit_types(items: list[SyncFruitType], db: AsyncSession = Depends(get_db)):
    return await receive_fruit_types(db, items)


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


# --- Model endpoints (protected by device API key in server mode) ---


@router.get("/models", dependencies=_device_dep)
async def list_models(db: AsyncSession = Depends(get_db)):
    """List active detection models with their file hashes."""
    result = await db.execute(
        select(DetectionModel).where(DetectionModel.is_active == True)  # noqa: E712
    )
    models = result.scalars().all()
    return [
        {
            "uuid": m.uuid,
            "filename": m.filename,
            "file_hash": m.file_hash,
            "version": m.version,
            "object_type": m.object_type,
        }
        for m in models
    ]


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
