"""Transcribe a ``{uuid}.classifications.jsonl`` sidecar into DB rows.

Shared by the robot's ``classification_poller`` (right after the worker finishes)
and the server's sync receiver (``routes/sync.py`` on
``/recordings/{uuid}/classifications/upload``). The jsonl is the source of truth;
both sides run the same transcription so the server's ``fruit_crops`` /
``fruit_classifications`` end up identical to the robot's.

Idempotent: any prior crops/classifications for the recording are deleted before
the new batch is inserted, so a reclassify (or a re-upload) never duplicates.
"""

from __future__ import annotations

import json
import os

from sqlalchemy import delete, select

from back.database import AsyncSessionLocal
from back.models import FruitClassification, FruitCrop, Recording
from back.services.perception.classification_trigger import (
    classifications_path_for,
    crops_dir_for,
)


async def transcribe_classifications(rec: Recording) -> int:
    """Read ``{uuid}.classifications.jsonl`` and (re)create crop + classification
    rows for ``rec``. Returns the number of crops written. Opens its own session
    so callers (poller / receiver) don't have to thread one through.
    """
    path = classifications_path_for(rec)
    crops_dir = crops_dir_for(rec)
    model_uuid = None
    if rec.classification_config:
        try:
            model_uuid = json.loads(rec.classification_config).get("model_uuid")
        except (json.JSONDecodeError, TypeError):
            model_uuid = None

    async with AsyncSessionLocal() as session:
        # Idempotent reclassify/re-upload: drop the prior crops (and their
        # classifications) for this recording before inserting the new batch.
        old = (
            await session.execute(
                select(FruitCrop.uuid).where(FruitCrop.recording_uuid == rec.uuid)
            )
        ).scalars().all()
        if old:
            await session.execute(
                delete(FruitClassification).where(
                    FruitClassification.crop_uuid.in_(old)
                )
            )
            await session.execute(
                delete(FruitCrop).where(FruitCrop.recording_uuid == rec.uuid)
            )

        written = 0
        if os.path.isfile(path):
            with open(path) as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    d = json.loads(line)
                    bbox = d.get("bbox") or [0, 0, 0, 0]
                    x1, y1, x2, y2 = bbox
                    crop_name = d.get("crop") or f"{d['track_id']}_{d['frame']}.jpg"
                    crop = FruitCrop(
                        recording_uuid=rec.uuid,
                        session_uuid=None,  # set when the recording is saved to a session
                        track_id=int(d["track_id"]),
                        image_path=os.path.join(crops_dir, crop_name),
                        bbox_x=float(x1),
                        bbox_y=float(y1),
                        bbox_w=float(x2 - x1),
                        bbox_h=float(y2 - y1),
                    )
                    session.add(crop)
                    await session.flush()  # assign crop.uuid before classification
                    session.add(
                        FruitClassification(
                            crop_uuid=crop.uuid,
                            model_uuid=model_uuid,
                            class_name=d["label"],
                            confidence=float(d.get("confidence") or 0.0),
                        )
                    )
                    written += 1
        await session.commit()
    return written
