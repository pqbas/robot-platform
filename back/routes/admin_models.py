"""Detection model management routes — admin only."""

import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.models import DetectionModel
from back.services.auth import require_role

router = APIRouter(prefix="/api", tags=["models"])
admin_dep = require_role("admin")


class DetectionModelOut(BaseModel):
    uuid: str
    version: str
    filename: str
    file_hash: str
    class_mapping: list = []
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


def _parse_class_mapping(raw: str | None) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _model_to_out(m: DetectionModel) -> dict:
    d = {c.name: getattr(m, c.name) for c in m.__table__.columns}
    d["class_mapping"] = _parse_class_mapping(m.class_mapping)
    return d


@router.get("/detection-models", response_model=list[DetectionModelOut])
async def list_detection_models(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(DetectionModel))
    return [_model_to_out(m) for m in result.scalars().all()]


@router.post("/detection-models", response_model=DetectionModelOut, status_code=201)
async def upload_detection_model(
    version: str = Form(...),
    uploaded_by: str = Form(...),
    class_mapping: str = Form("[]"),
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
    models_dir.mkdir(parents=True, exist_ok=True)
    file_path = models_dir / file.filename
    content = await file.read()
    file_path.write_bytes(content)

    # Compute hash
    file_hash = hashlib.sha256(content).hexdigest()

    model = DetectionModel(
        version=version,
        filename=file.filename,
        file_hash=file_hash,
        class_mapping=class_mapping,
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
    return _model_to_out(model)


@router.patch("/detection-models/{uuid}", response_model=DetectionModelOut)
async def update_detection_model(
    uuid: str,
    version: str | None = Form(None),
    class_mapping: str | None = Form(None),
    epochs: int | None = Form(None),
    map50: float | None = Form(None),
    map50_95: float | None = Form(None),
    precision_val: float | None = Form(None, alias="precision"),
    recall: float | None = Form(None),
    dataset_size: int | None = Form(None),
    notes: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(admin_dep),
):
    result = await db.execute(select(DetectionModel).where(DetectionModel.uuid == uuid))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    if file and file.filename:
        models_dir = Path(config.storage.models_dir)
        models_dir.mkdir(parents=True, exist_ok=True)
        content = await file.read()
        new_filename = file.filename
        if new_filename != model.filename:
            old_path = models_dir / model.filename
            if old_path.exists():
                old_path.unlink()
        new_path = models_dir / new_filename
        new_path.write_bytes(content)
        model.filename = new_filename
        model.file_hash = hashlib.sha256(content).hexdigest()

    if version is not None:
        model.version = version
    if class_mapping is not None:
        model.class_mapping = class_mapping
    if epochs is not None:
        model.epochs = epochs
    if map50 is not None:
        model.map50 = map50
    if map50_95 is not None:
        model.map50_95 = map50_95
    if precision_val is not None:
        model.precision = precision_val
    if recall is not None:
        model.recall = recall
    if dataset_size is not None:
        model.dataset_size = dataset_size
    if notes is not None:
        model.notes = notes

    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


@router.put("/detection-models/{uuid}/activate", response_model=DetectionModelOut)
async def activate_model(uuid: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(DetectionModel).where(DetectionModel.uuid == uuid))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Deactivate all other active models
    others = await db.execute(
        select(DetectionModel).where(
            DetectionModel.uuid != uuid,
            DetectionModel.is_active == True,  # noqa: E712
        )
    )
    for other in others.scalars().all():
        other.is_active = False

    model.is_active = True
    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


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
