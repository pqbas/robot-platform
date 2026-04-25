"""Seed library models that ship with ultralytics — no admin action needed."""

import json
import logging

from sqlalchemy import select

from back.database import AsyncSessionLocal
from back.models import DetectionModel

logger = logging.getLogger(__name__)


_PERSON_MAPPING = json.dumps([{"model_label": "person", "system_label": "Persona"}])


# Standard YOLO11 variants that come with ultralytics. Filename → metadata.
_LIBRARY_MODELS = [
    {
        "filename": "yolo11n.pt",
        "version": "yolo11n-coco",
        "notes": "YOLO11 nano — más rápido, menor precisión",
    },
    {
        "filename": "yolo11s.pt",
        "version": "yolo11s-coco",
        "notes": "YOLO11 small — balance velocidad/precisión",
    },
    {
        "filename": "yolo11m.pt",
        "version": "yolo11m-coco",
        "notes": "YOLO11 medium — más preciso, más lento",
    },
]


async def seed_library_models() -> None:
    """Insert standard ultralytics models if they don't exist. Idempotent."""
    async with AsyncSessionLocal() as session:
        for spec in _LIBRARY_MODELS:
            result = await session.execute(
                select(DetectionModel).where(DetectionModel.filename == spec["filename"])
            )
            if result.scalar_one_or_none() is not None:
                continue
            session.add(DetectionModel(
                filename=spec["filename"],
                version=spec["version"],
                file_hash=None,
                source="library",
                class_mapping=_PERSON_MAPPING,
                notes=spec["notes"],
                uploaded_by="system",
                is_active=True,
            ))
            logger.info("Seeded library model: %s", spec["filename"])
        await session.commit()
