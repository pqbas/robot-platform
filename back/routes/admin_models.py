"""Detection model and fruit type management routes — admin only."""

import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.models import DetectionModel, FruitType
from back.services.auth import require_role

router = APIRouter(prefix="/api", tags=["models"])
admin_dep = require_role("admin")


# --- Fruit Types ---


class FruitTypeCreate(BaseModel):
    name: str


class FruitTypeOut(BaseModel):
    uuid: str
    name: str
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/fruit-types", response_model=list[FruitTypeOut])
async def list_fruit_types(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(FruitType))
    return result.scalars().all()


@router.post("/fruit-types", response_model=FruitTypeOut, status_code=201)
async def create_fruit_type(body: FruitTypeCreate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    ft = FruitType(name=body.name)
    db.add(ft)
    await db.commit()
    await db.refresh(ft)
    return ft


# --- Detection Models ---


class DetectionModelOut(BaseModel):
    uuid: str
    fruit_type_uuid: str
    object_type: str
    version: str
    filename: str
    file_hash: str
    epochs: int | None
    map50: float | None
    map50_95: float | None
    precision: float | None
    recall: float | None
    dataset_size: int | None
    notes: str | None
    uploaded_by: str
    is_active: bool
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/detection-models", response_model=list[DetectionModelOut])
async def list_detection_models(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(DetectionModel))
    return result.scalars().all()


@router.post("/detection-models", response_model=DetectionModelOut, status_code=201)
async def upload_detection_model(
    fruit_type_uuid: str = Form(...),
    object_type: str = Form(...),
    version: str = Form(...),
    uploaded_by: str = Form(...),
    epochs: int | None = Form(None),
    map50: float | None = Form(None),
    map50_95: float | None = Form(None),
    precision_val: float | None = Form(None, alias="precision"),
    recall: float | None = Form(None),
    dataset_size: int | None = Form(None),
    notes: str | None = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(admin_dep),
):
    # Save file to disk
    models_dir = Path(config.storage.models_dir)
    file_path = models_dir / file.filename
    content = await file.read()
    file_path.write_bytes(content)

    # Compute hash
    file_hash = hashlib.sha256(content).hexdigest()

    model = DetectionModel(
        fruit_type_uuid=fruit_type_uuid,
        object_type=object_type,
        version=version,
        filename=file.filename,
        file_hash=file_hash,
        uploaded_by=uploaded_by,
        epochs=epochs,
        map50=map50,
        map50_95=map50_95,
        precision=precision_val,
        recall=recall,
        dataset_size=dataset_size,
        notes=notes,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return model


@router.put("/detection-models/{uuid}/activate", response_model=DetectionModelOut)
async def activate_model(uuid: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(DetectionModel).where(DetectionModel.uuid == uuid))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Deactivate other models of the same fruit type
    others = await db.execute(
        select(DetectionModel).where(
            DetectionModel.fruit_type_uuid == model.fruit_type_uuid,
            DetectionModel.uuid != uuid,
            DetectionModel.is_active == True,  # noqa: E712
        )
    )
    for other in others.scalars().all():
        other.is_active = False

    model.is_active = True
    await db.commit()
    await db.refresh(model)
    return model


@router.delete("/detection-models/{uuid}", status_code=204)
async def delete_model(uuid: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(DetectionModel).where(DetectionModel.uuid == uuid))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Delete file from disk
    file_path = Path(config.storage.models_dir) / model.filename
    if file_path.exists():
        file_path.unlink()

    await db.delete(model)
    await db.commit()
