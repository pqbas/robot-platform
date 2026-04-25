import json
import os
import re
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.models import DetectionModel
from back.schemas import (
    AvailableLabelItem,
    CameraConfigOut,
    CameraConfigUpdate,
    CameraDevice,
    CountingConfigOut,
    CountingConfigUpdate,
    SelectLabelRequest,
)
from back.services.perception.inference_client import InferenceClient

router = APIRouter(prefix="/api/config", tags=["config"])


# --- Camera ---


def _get_device_name(index: int) -> str:
    """Read the device name from sysfs (Linux)."""
    name_path = f"/sys/class/video4linux/video{index}/name"
    if os.path.exists(name_path):
        with open(name_path) as f:
            raw = f.read().strip()
        # Clean duplicated names like "ZED 2: ZED 2" -> "ZED 2"
        parts = raw.split(": ", 1)
        if len(parts) == 2 and parts[0] == parts[1]:
            return parts[0]
        return raw
    return f"Camera {index}"


def _list_video_devices() -> list[CameraDevice]:
    """List video devices from /dev/videoN and read their names from sysfs."""
    devices: list[CameraDevice] = []
    seen_names: set[str] = set()
    dev_dir = "/dev"
    for entry in sorted(os.listdir(dev_dir)):
        match = re.match(r"video(\d+)$", entry)
        if not match:
            continue
        index = int(match.group(1))
        name = _get_device_name(index)
        # Skip duplicate entries (same device often registers multiple /dev/videoN)
        if name in seen_names:
            continue
        seen_names.add(name)
        cap = cv2.VideoCapture(index)
        available = cap.isOpened()
        if available:
            cap.release()
        devices.append(CameraDevice(index=index, name=name, available=available))
    return devices


@router.get("/cameras", response_model=list[CameraDevice])
async def list_cameras():
    return _list_video_devices()


@router.get("/camera", response_model=CameraConfigOut)
async def get_camera_config():
    c = config.camera
    return CameraConfigOut(
        index=c.index,
        frame_width=c.frame_width,
        frame_height=c.frame_height,
        crop_width=c.crop_width,
    )


@router.put("/camera", response_model=CameraConfigOut)
async def update_camera_config(body: CameraConfigUpdate):
    c = config.camera
    if body.index is not None:
        c.index = body.index
    if body.frame_width is not None:
        c.frame_width = body.frame_width
    if body.frame_height is not None:
        c.frame_height = body.frame_height
    if body.crop_width is not None:
        c.crop_width = body.crop_width
    return CameraConfigOut(
        index=c.index,
        frame_width=c.frame_width,
        frame_height=c.frame_height,
        crop_width=c.crop_width,
    )


# --- Counting ---


@router.get("/counting", response_model=CountingConfigOut)
async def get_counting_config():
    c = config.counting
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
    )


@router.put("/counting", response_model=CountingConfigOut)
async def update_counting_config(body: CountingConfigUpdate):
    c = config.counting
    if body.count_mode is not None:
        c.count_mode = body.count_mode
    if body.threshold is not None:
        c.threshold = body.threshold
    if body.direction is not None:
        c.direction = body.direction
    if body.confidence_threshold is not None:
        c.confidence_threshold = body.confidence_threshold
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
    )


# --- Vision labels ---


@router.get("/available-labels", response_model=list[AvailableLabelItem])
async def get_available_labels(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DetectionModel))
    models = result.scalars().all()
    labels: list[AvailableLabelItem] = []
    for m in models:
        if not m.class_mapping:
            continue
        try:
            mapping = json.loads(m.class_mapping)
        except (json.JSONDecodeError, TypeError):
            continue
        for entry in mapping:
            if isinstance(entry, str):
                label = entry
            else:
                label = entry.get("system_label") or entry.get("model_label")
            if label:
                labels.append(AvailableLabelItem(label=label, model_filename=m.filename))
    return labels


@router.post("/select-label")
async def select_label(body: SelectLabelRequest, db: AsyncSession = Depends(get_db)):
    # Determine if this filename refers to a library model (managed by ultralytics)
    # or an uploaded model (file in storage). Library models receive the bare
    # filename; uploaded models receive the absolute path.
    result = await db.execute(
        select(DetectionModel).where(DetectionModel.filename == body.model_filename)
    )
    model = result.scalar_one_or_none()
    if model and model.source == "library":
        worker_path = body.model_filename
    else:
        worker_path = str(Path(config.storage.models_dir) / body.model_filename)

    client = InferenceClient(config.perception.socket_path)
    reload_result = client.reload_model(worker_path)
    if reload_result is None:
        raise HTTPException(status_code=503, detail="Inference worker not available")
    return {"ok": True, "model": body.model_filename}
