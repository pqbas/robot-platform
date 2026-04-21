"""Device (robot) management routes — admin only."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.models import DetectionModel, Device, DeviceModel
from back.services.auth import generate_api_key, hash_api_key, require_role

router = APIRouter(prefix="/api/devices", tags=["devices"])
admin_dep = require_role("admin")


class DeviceModelOut(BaseModel):
    uuid: str
    version: str
    filename: str
    class_mapping: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class SetDeviceModelsRequest(BaseModel):
    model_uuids: list[str]


class DeviceCreate(BaseModel):
    id: str  # e.g. "jetson-12345" or "dev-robot-001"
    label: str  # e.g. "Robot Mark 1"


class DeviceUpdate(BaseModel):
    label: str | None = None
    is_active: bool | None = None


class DeviceOut(BaseModel):
    id: str
    label: str
    last_sync_at: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class DeviceCreateResponse(BaseModel):
    """Returned only on creation — includes the API key (shown once)."""
    id: str
    label: str
    api_key: str


@router.get("/", response_model=list[DeviceOut])
async def list_devices(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Device))
    return result.scalars().all()


@router.post("/", response_model=DeviceCreateResponse, status_code=201)
async def register_device(body: DeviceCreate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    # Check if device already exists
    existing = await db.execute(select(Device).where(Device.id == body.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Device ID already registered")

    api_key = generate_api_key()
    device = Device(
        id=body.id,
        label=body.label,
        api_key_hash=hash_api_key(api_key),
    )
    db.add(device)
    await db.commit()
    return DeviceCreateResponse(id=device.id, label=device.label, api_key=api_key)


@router.post("/{device_id}/rotate-api-key", response_model=DeviceCreateResponse)
async def rotate_api_key(device_id: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    api_key = generate_api_key()
    device.api_key_hash = hash_api_key(api_key)
    await db.commit()
    return DeviceCreateResponse(id=device.id, label=device.label, api_key=api_key)


@router.get("/{device_id}/models", response_model=list[DeviceModelOut])
async def get_device_models(device_id: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Device not found")
    result = await db.execute(
        select(DetectionModel)
        .join(DeviceModel, DeviceModel.model_uuid == DetectionModel.uuid)
        .where(DeviceModel.device_id == device_id)
    )
    return result.scalars().all()


@router.put("/{device_id}/models")
async def set_device_models(device_id: str, body: SetDeviceModelsRequest, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Device not found")
    await db.execute(delete(DeviceModel).where(DeviceModel.device_id == device_id))
    for model_uuid in body.model_uuids:
        db.add(DeviceModel(device_id=device_id, model_uuid=model_uuid))
    await db.commit()
    return {"ok": True}


@router.put("/{device_id}", response_model=DeviceOut)
async def update_device(device_id: str, body: DeviceUpdate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if body.label is not None:
        device.label = body.label
    if body.is_active is not None:
        device.is_active = body.is_active
    await db.commit()
    await db.refresh(device)
    return device
