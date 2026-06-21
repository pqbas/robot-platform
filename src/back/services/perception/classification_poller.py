"""Background reconciler + poller for offline classification jobs.

Mirror of ``counting_poller`` for ripeness classification:

1. **Startup reconciliation.** Any ``Recording`` stuck in
   ``classification_status='classifying'`` at startup is orphaned (the worker is
   a separate process, idle when the backend booted). Re-enqueue with its pinned
   config if the MP4 + crossings + model still exist; otherwise mark ``error``.

2. **Async poller.** While at least one recording is ``classifying``, poll
   ``ClassificationClient.status()`` every 5 s. When the worker reports a
   ``last_result``, transcribe ``{uuid}.classifications.jsonl`` into
   ``FruitCrop`` (+ ``recording_uuid``) and ``FruitClassification`` rows.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from sqlalchemy import delete, select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import FruitClassification, FruitCrop, Recording
from back.services.perception.classification_client import (
    ClassificationClient,
    ClassificationWorkerUnavailable,
)
from back.services.perception.classification_trigger import (
    classifications_path_for,
    crops_dir_for,
    enqueue_classification,
)

logger = logging.getLogger("classification_poller")

POLL_INTERVAL_SECONDS = 5.0


async def reconcile_orphaned_classifications() -> None:
    """At backend startup, re-enqueue or fail any orphaned 'classifying' row."""
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(Recording).where(
                    Recording.classification_status == "classifying"
                )
            )
        ).scalars().all()
        if not rows:
            return
        for rec in rows:
            cfg = None
            if rec.classification_config:
                try:
                    cfg = json.loads(rec.classification_config)
                except json.JSONDecodeError:
                    cfg = None
            if cfg is None:
                rec.classification_status = "error"
                rec.classification_error = "classification_config ausente o inválido"
                continue
            if not os.path.isfile(rec.file_path):
                rec.classification_status = "error"
                rec.classification_error = "MP4 no encontrado"
                continue
            logger.info("Re-encolando clasificación huérfana: %s", rec.uuid)
            await enqueue_classification(session, rec, cfg)
        await session.commit()


async def _transcribe_results(rec: Recording) -> int:
    """Read ``{uuid}.classifications.jsonl`` and (re)create crop + classification
    rows for ``rec``. Returns the number of crops written. Deletes any prior
    crops/classifications for this recording first so a reclassify is idempotent.
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
        # Idempotent reclassify: drop the prior crops (and their classifications)
        # for this recording before inserting the new batch.
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


async def _process_worker_result(last_result: dict) -> None:
    """Transcribe a worker last_result into the matching Recording (by uuid)."""
    uuid = last_result.get("uuid")
    if not uuid:
        return
    rec = None
    async with AsyncSessionLocal() as session:
        rec = (
            await session.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one_or_none()
        if rec is None or rec.classification_status != "classifying":
            # Already transcribed, reclassify superseded, or unknown uuid.
            return

    if last_result.get("ok"):
        written = await _transcribe_results(rec)
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(Recording).where(Recording.uuid == uuid)
                )
            ).scalar_one_or_none()
            if row is None:
                return
            row.classification_status = "done"
            row.classification_error = None
            # Results just (re)written — mark dirty so the upload loop (G5) pushes
            # the classifications metadata. NULL + status 'done' ⇒ needs upload.
            row.classifications_uploaded_at = None
            await session.commit()
        logger.info("Clasificación lista %s: %d crops", uuid, written)
    else:
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(Recording).where(Recording.uuid == uuid)
                )
            ).scalar_one_or_none()
            if row is None:
                return
            row.classification_status = "error"
            row.classification_error = last_result.get("error") or "unknown"
            await session.commit()
        logger.warning("Clasificación falló %s: %s", uuid, last_result.get("error"))


async def run_poller() -> None:
    """Loop forever. Cheap when nothing is classifying (one DB query per tick);
    does the worker round-trip only when at least one row is ``classifying``."""
    seen_finished_at: str | None = None
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            async with AsyncSessionLocal() as session:
                classifying = (
                    await session.execute(
                        select(Recording).where(
                            Recording.classification_status == "classifying"
                        )
                    )
                ).scalars().all()
            if not classifying:
                continue

            client = ClassificationClient(
                config.classification_worker.control_socket_path
            )
            try:
                status = client.status()
            except ClassificationWorkerUnavailable as exc:
                logger.warning("Classification worker unreachable: %s", exc)
                continue

            last = status.get("last_result")
            if not last:
                continue
            finished_at = last.get("finished_at")
            if finished_at and finished_at == seen_finished_at:
                continue

            await _process_worker_result(last)
            if finished_at:
                seen_finished_at = finished_at
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Classification poller iteration failed")
