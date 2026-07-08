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

from sqlalchemy import select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import Recording
from back.services.perception.classification_client import (
    ClassificationClient,
    ClassificationWorkerUnavailable,
)
from back.services.perception.classification_ingest import transcribe_classifications
from back.services.perception.classification_trigger import enqueue_classification

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
        written = await transcribe_classifications(rec)
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
            # Results just (re)written — mark dirty so the upload loop pushes the
            # classifications metadata AND the regenerated crops. NULL + status
            # 'done' ⇒ needs upload.
            row.classifications_uploaded_at = None
            row.crops_uploaded_at = None
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
