"""Background reconciler + poller for TensorRT conversions.

Two responsibilities:

1. **Startup reconciliation.** Any ``DetectionModel`` row stuck in
   ``engine_status='converting'`` at startup must be a stale row from a
   prior backend session — the conversion-worker is a separate process
   and was not converting anything when the backend just booted. Mark
   those rows as ``error`` so the operator can retry from /settings.

2. **Async poller.** While at least one model is in ``converting``,
   poll ``ConversionClient.status()`` every 5 s. When the worker reports
   ``last_result`` for the current job, transcribe the outcome to DB
   (``ready`` or ``error``) and, if the model whose conversion just
   finished is the one currently active in the inference-worker, swap
   its loaded weights to the new ``.engine`` automatically.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from sqlalchemy import select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import DetectionModel
from back.services.perception.conversion_client import (
    ConversionClient,
    ConversionWorkerUnavailable,
)
from back.services.perception.engine_paths import engine_cache_path_for
from back.services.perception.inference_client import InferenceClient
from back.services.perception.label_selection import derive_filtered_class_mapping

logger = logging.getLogger("conversion_poller")

POLL_INTERVAL_SECONDS = 5.0


async def reconcile_orphaned_conversions() -> None:
    """At backend startup, any 'converting' row is stale — the worker is
    a separate process and was idle when the backend just booted.

    If the engine file already exists on disk, the previous build actually
    succeeded and only the DB transition was lost (e.g. backend killed
    between worker finish and poller tick). Promote those to ``ready``
    instead of marking them as errors."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(DetectionModel).where(
                DetectionModel.engine_status == "converting"
            )
        )
        stuck = result.scalars().all()
        if not stuck:
            return
        for m in stuck:
            engine_path = _engine_path_for_model(m)
            if engine_path and os.path.exists(engine_path):
                m.engine_status = "ready"
                m.engine_error = None
                logger.info(
                    "Reconciled converting row to ready (engine on disk): %s",
                    m.filename,
                )
            else:
                m.engine_status = "error"
                m.engine_error = "Backend reiniciado durante conversión"
                logger.warning("Reconciled stale converting row: %s", m.filename)
        await session.commit()


def _engine_path_for_model(model: DetectionModel) -> str | None:
    if not model.file_hash:
        return None
    return engine_cache_path_for(
        model.filename, model.file_hash, config.storage.models_dir
    )


async def _maybe_reload_active_model(engine_path: str) -> None:
    """If the inference-worker is loaded with this model's .pt, swap it
    for the freshly-built .engine without operator intervention."""
    inference = InferenceClient(config.perception.socket_path)
    status = inference.send_command("status")
    if not status:
        logger.info(
            "Inference worker did not respond to status — skipping auto-reload"
        )
        return
    current = status.get("model_path") or ""
    # Match by .pt stem: if engine is `blueberry.<hash>.fp16.engine` and
    # the worker is loaded with `.../blueberry.pt`, they refer to the
    # same underlying model.
    engine_stem = Path(engine_path).name.split(".")[0]
    current_stem = Path(current).stem
    if engine_stem and engine_stem == current_stem:
        # Re-derive the user's class filter from the persisted
        # selected_label so the .pt→.engine swap doesn't wipe it.
        class_mapping: list = []
        async with AsyncSessionLocal() as db:
            row = (await db.execute(
                select(DetectionModel).where(
                    DetectionModel.filename == f"{engine_stem}.pt"
                )
            )).scalar_one_or_none()
            if row and row.selected_label:
                class_mapping = derive_filtered_class_mapping(
                    row.class_mapping, row.selected_label
                )
        logger.info("Auto-reloading inference worker with %s", engine_path)
        result = inference.reload_model(engine_path, class_mapping=class_mapping)
        if not result or not result.get("ok"):
            logger.warning("Auto-reload failed: %s", result)


async def _process_worker_result(
    last_result: dict, current: dict | None
) -> None:
    """Transcribe a worker last_result into DB state for the matching row.

    The worker reports the engine_path it was asked to build; we find
    the row whose computed engine_path matches and update it.
    """
    target_engine = (current or {}).get("engine_path") or last_result.get(
        "engine_path"
    )
    if not target_engine:
        return

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(DetectionModel).where(
                DetectionModel.engine_status == "converting"
            )
        )
        candidates = result.scalars().all()
        # Find the row whose computed engine path matches the worker's
        # target — the operator may have toggled multiple models in
        # quick succession (refused) but exactly one is converting.
        target_abs = os.path.abspath(target_engine)
        for m in candidates:
            expected = _engine_path_for_model(m)
            if expected and os.path.abspath(expected) == target_abs:
                if last_result.get("ok"):
                    m.engine_status = "ready"
                    m.engine_error = None
                    logger.info("Conversion ready: %s", m.filename)
                    await session.commit()
                    await _maybe_reload_active_model(target_engine)
                else:
                    m.engine_status = "error"
                    m.engine_error = last_result.get("error") or "unknown"
                    logger.warning(
                        "Conversion failed: %s -> %s", m.filename, m.engine_error
                    )
                    await session.commit()
                return
        logger.info(
            "Worker reported %s but no matching converting row; ignoring",
            target_engine,
        )


async def run_poller() -> None:
    """Loop forever. Cheap when nothing is converting (one DB query per
    tick); does the worker round-trip only when at least one row is in
    ``converting``."""
    seen_finished_at: str | None = None
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(DetectionModel).where(
                        DetectionModel.engine_status == "converting"
                    )
                )
                converting_count = len(result.scalars().all())
            if converting_count == 0:
                continue

            client = ConversionClient(config.conversion.control_socket_path)
            try:
                status = client.status()
            except ConversionWorkerUnavailable as exc:
                logger.warning("Conversion worker unreachable: %s", exc)
                continue

            last = status.get("last_result")
            if not last:
                continue
            finished_at = last.get("finished_at")
            if finished_at and finished_at == seen_finished_at:
                # Already transcribed this result on a previous tick.
                continue

            await _process_worker_result(last, status.get("current"))
            if finished_at:
                seen_finished_at = finished_at
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Conversion poller iteration failed")
