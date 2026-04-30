"""Robot-only endpoints to manage TensorRT engines per assigned model.

Sister of ``back/routes/admin_models.py`` (server-side CRUD): this one
runs on the robot, exposes only the locally-assigned models, and lets
the operator toggle TensorRT compilation per model.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import DetectionModel
from back.services.perception.conversion_client import (
    ConversionClient,
    ConversionWorkerUnavailable,
)
from back.services.perception.engine_paths import engine_exists, engine_path_for

logger = logging.getLogger("models_local")

router = APIRouter(prefix="/api/models", tags=["models"])


def _require_robot_mode() -> None:
    if config.mode != AppMode.ROBOT:
        raise HTTPException(404, "Local models endpoint is robot-only")


class LocalModelOut(BaseModel):
    uuid: str
    filename: str
    tensorrt_enabled: bool
    engine_status: str
    engine_error: str | None


class TensorRTToggle(BaseModel):
    enabled: bool


class TensorRTToggleResponse(BaseModel):
    engine_status: str


def _pt_path_for(model: DetectionModel) -> str:
    return str(Path(config.storage.models_dir) / model.filename)


@router.get("", response_model=list[LocalModelOut])
async def list_local_models(db: AsyncSession = Depends(get_db)):
    _require_robot_mode()
    result = await db.execute(select(DetectionModel))
    models = result.scalars().all()
    out: list[LocalModelOut] = []
    for m in models:
        # Library models (yolo11n.pt etc.) cannot be converted — they live
        # in the ultralytics cache, not on disk under MODELS_DIR. Hide
        # them from the toggle list to keep the UI honest.
        if m.source == "library":
            continue
        out.append(
            LocalModelOut(
                uuid=m.uuid,
                filename=m.filename,
                tensorrt_enabled=m.tensorrt_enabled,
                engine_status=m.engine_status,
                engine_error=m.engine_error,
            )
        )
    return out


@router.put("/{uuid}/tensorrt", response_model=TensorRTToggleResponse)
async def set_model_tensorrt(
    uuid: str,
    body: TensorRTToggle,
    db: AsyncSession = Depends(get_db),
):
    _require_robot_mode()

    result = await db.execute(
        select(DetectionModel).where(DetectionModel.uuid == uuid)
    )
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(404, "model not found")
    if model.source == "library":
        raise HTTPException(400, "library models cannot be converted")
    if not model.file_hash:
        raise HTTPException(
            400, "model has no file_hash yet (sync from server first)"
        )

    pt_path = _pt_path_for(model)

    if not body.enabled:
        # Operator turns it off: keep the .engine on disk so re-enabling
        # is instant, but flip status back to pytorch and clear errors.
        model.tensorrt_enabled = False
        model.engine_status = "pytorch"
        model.engine_error = None
        await db.commit()
        return TensorRTToggleResponse(engine_status="pytorch")

    engine_path = engine_path_for(pt_path, model.file_hash)

    # Cache hit: the .engine for this exact .pt hash is already on disk.
    if engine_exists(pt_path, model.file_hash):
        model.tensorrt_enabled = True
        model.engine_status = "ready"
        model.engine_error = None
        await db.commit()
        return TensorRTToggleResponse(engine_status="ready")

    if not Path(pt_path).exists():
        raise HTTPException(
            500, f".pt missing on disk: {pt_path} — sync from server first"
        )

    client = ConversionClient(config.conversion.control_socket_path)
    try:
        worker_status = client.status()
    except ConversionWorkerUnavailable as exc:
        logger.warning("Conversion worker unavailable: %s", exc)
        raise HTTPException(503, "Conversion worker no responde")

    if worker_status.get("state") == "converting":
        raise HTTPException(409, "Conversión en curso, espera a que termine")

    try:
        resp = client.convert(pt_path, engine_path, precision="fp16")
    except ConversionWorkerUnavailable as exc:
        raise HTTPException(503, f"Conversion worker unavailable: {exc}")

    if not resp.get("ok"):
        # Race: another caller grabbed the worker between status and convert.
        if resp.get("error") == "busy":
            raise HTTPException(409, "Conversión en curso, espera a que termine")
        raise HTTPException(500, f"convert failed: {resp.get('error')}")

    model.tensorrt_enabled = True
    model.engine_status = "converting"
    model.engine_error = None
    await db.commit()
    return TensorRTToggleResponse(engine_status="converting")
