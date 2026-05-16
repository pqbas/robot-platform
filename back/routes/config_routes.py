import json
import logging
import os
import re

import cv2
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import DetectionModel, Recording
from back.schemas import (
    AvailableLabelItem,
    CameraConfigOut,
    CameraConfigUpdate,
    CameraDevice,
    CameraResolutionOut,
    CameraResolutionUpdate,
    CountingConfigOut,
    CountingConfigUpdate,
    SelectLabelRequest,
)
from back.services import camera_settings
from back.services.camera_control_client import (
    CameraControlClient,
    CameraWorkerUnavailable,
)
from back.services.perception import counter
from back.services.perception.engine_paths import (
    actual_pt_path_for,
    engine_cache_path_for,
)
from back.services.perception.inference_client import InferenceClient
from back.services.perception.label_selection import derive_filtered_class_mapping

logger = logging.getLogger("config_routes")

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


# --- Camera resolution preset (Phase 11) ---


def _require_robot_mode() -> None:
    if config.mode != AppMode.ROBOT:
        raise HTTPException(404, "Resolution preset is robot-only")


@router.get("/camera/resolution", response_model=CameraResolutionOut)
async def get_camera_resolution():
    _require_robot_mode()
    return CameraResolutionOut(preset=camera_settings.read_preset())


@router.put("/camera/resolution", response_model=CameraResolutionOut)
async def update_camera_resolution(
    body: CameraResolutionUpdate, db: AsyncSession = Depends(get_db)
):
    _require_robot_mode()

    # Block while a counting session is in flight — changing the camera mid
    # session would lose tracker state and corrupt the count.
    if counter.is_session_active():
        raise HTTPException(
            409, "Detén el conteo antes de cambiar la resolución"
        )

    # Block while a recording is in flight — closing the camera socket would
    # truncate the MP4 in a half-finalised state.
    in_flight = await db.execute(
        select(Recording).where(Recording.ended_at.is_(None))
    )
    if in_flight.scalar_one_or_none() is not None:
        raise HTTPException(
            409, "Detén la grabación antes de cambiar la resolución"
        )

    camera_settings.write_preset(body.preset)

    client = CameraControlClient(config.camera.control_socket_path)
    try:
        resp = client.reload()
    except CameraWorkerUnavailable as exc:
        logger.warning("Camera worker control socket unavailable: %s", exc)
        raise HTTPException(
            503, "Camera worker no responde; revisa el servicio."
        )
    if not resp.get("ok"):
        logger.warning("Camera worker reload returned error: %s", resp)
        raise HTTPException(503, f"Camera worker reload failed: {resp.get('error')}")

    return CameraResolutionOut(preset=body.preset)


# --- Counting ---


@router.get("/counting", response_model=CountingConfigOut)
async def get_counting_config():
    c = config.counting
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
        roi_mode=c.roi_mode,  # type: ignore[arg-type]
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
    if body.roi_mode is not None:
        c.roi_mode = body.roi_mode
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
        roi_mode=c.roi_mode,  # type: ignore[arg-type]
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
                labels.append(AvailableLabelItem(label=label, model_filename=m.filename, source=m.source))
    return labels


@router.post("/select-label")
async def select_label(body: SelectLabelRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DetectionModel).where(DetectionModel.filename == body.model_filename)
    )
    model = result.scalar_one_or_none()

    # Default fallback (no DB row): ultralytics resolves the bare filename.
    if model is None:
        worker_path = body.model_filename
    else:
        # If TensorRT is on and the engine is built, hand the .engine to
        # the inference-worker — applies to both library and uploaded
        # models, since the engine cache lives in MODELS_DIR either way.
        if (
            model.tensorrt_enabled
            and model.engine_status == "ready"
            and model.file_hash
        ):
            engine_path = engine_cache_path_for(
                model.filename, model.file_hash, config.storage.models_dir
            )
            if os.path.exists(engine_path):
                worker_path = engine_path
            else:
                worker_path = actual_pt_path_for(
                    model.filename, model.source, config.storage.models_dir
                )
        else:
            worker_path = actual_pt_path_for(
                model.filename, model.source, config.storage.models_dir
            )

    # Absolutise non-bare paths — the inference worker's cwd
    # (/opt/robot-platform/inference) differs from the backend's
    # (/opt/robot-platform), so a relative ``data/...`` would resolve
    # against the wrong root. Bare filenames (library .pt) are left alone
    # so ultralytics can do its own cache lookup / auto-download.
    if os.sep in worker_path or worker_path.startswith("."):
        worker_path = os.path.abspath(worker_path)

    class_mapping: list = []
    if model is not None:
        class_mapping = derive_filtered_class_mapping(model.class_mapping, body.label)

    client = InferenceClient(config.perception.socket_path)
    reload_result = client.reload_model(worker_path, class_mapping=class_mapping)
    if reload_result is None:
        raise HTTPException(status_code=503, detail="Inference worker not available")
    if not reload_result.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=f"Inference worker rejected reload: {reload_result.get('error')}",
        )

    # Persist the selection globally: only one model holds selected_label
    # at a time, so reloads from sync_pull / conversion_poller can re-derive
    # the same filter instead of wiping it.
    if model is not None:
        await db.execute(
            update(DetectionModel)
            .where(DetectionModel.filename != body.model_filename)
            .values(selected_label=None)
        )
        model.selected_label = body.label
        await db.commit()

    return {"ok": True, "model": body.model_filename, "loaded": worker_path}
