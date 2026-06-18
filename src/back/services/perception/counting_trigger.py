"""Build the count_config snapshot + enqueue an offline count job.

Shared by ``counting.py::stop_counting`` (initial count, snapshots the active
model) and ``recordings.py::recount`` (reproduce with the pinned model, or
re-pin the active one). The video is the source of truth; count_config pins the
model identity (uuid/version/file_hash/engine_path) so a count is reproducible
and a recount months later doesn't silently use a different model.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.models import DetectionModel, Recording
from back.services.perception.counting_client import (
    CountingClient,
    CountingWorkerUnavailable,
)
from back.services.perception.engine_paths import worker_model_path_for

logger = logging.getLogger("counting_trigger")


def iso_to_epoch(iso: str | None) -> float | None:
    """Parse stored ISO ('%Y-%m-%dT%H:%M:%SZ', UTC) to epoch seconds. Mirrors
    recordings.py so the worker's `t = started_epoch + frame/fps` lines up with
    the detections endpoint's started_epoch (replay anchors to it)."""
    if not iso:
        return None
    try:
        return (
            datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
            .replace(tzinfo=timezone.utc)
            .timestamp()
        )
    except ValueError:
        return None


async def build_count_config(db: AsyncSession, target_class: str | None) -> dict:
    """Snapshot the counting config + the active model's identity.

    The active model is the one holding ``selected_label`` (the same selection
    the live inference path / ``model_reconciler`` uses) — NOT the legacy
    ``is_active`` flag, which the rest of the codebase no longer sets.

    Raises RuntimeError if there is no active detection model (caller marks the
    recording as error)."""
    result = await db.execute(
        select(DetectionModel)
        .where(DetectionModel.selected_label.isnot(None))
        .limit(1)
    )
    model = result.scalars().first()
    if model is None:
        raise RuntimeError("no_active_model")

    engine_path = worker_model_path_for(
        model.filename,
        model.source,
        model.file_hash,
        model.tensorrt_enabled,
        model.engine_status,
        config.storage.models_dir,
    )
    c = config.counting
    return {
        "count_mode": c.count_mode,
        "threshold": c.threshold,
        "direction": c.direction,
        "roi_mode": c.roi_mode,
        "confidence": c.confidence_threshold,
        "target_class": target_class,
        "model_uuid": model.uuid,
        "model_version": model.version,
        "file_hash": model.file_hash,
        "engine_path": engine_path,
    }


def _jsonl_path_for(rec: Recording) -> str:
    return os.path.join(os.path.dirname(rec.file_path), f"{rec.uuid}.jsonl")


async def enqueue_count(db: AsyncSession, rec: Recording, count_config: dict) -> None:
    """Persist count_config + mark counting, then hand the job to the worker.

    Worker-unavailable / missing-engine is recorded as count_status='error' so
    the operator isn't blocked and reconciliation/recount can retry. Does NOT
    raise — the caller (stop flow) must not abort on a counting failure.
    """
    rec.count_config = json.dumps(count_config)
    rec.count_error = None

    engine_path = count_config.get("engine_path") or ""
    if not engine_path or (os.sep in engine_path and not os.path.exists(engine_path)):
        rec.count_status = "error"
        rec.count_error = f"engine no disponible: {engine_path}"
        logger.warning("Count not enqueued for %s: missing engine", rec.uuid)
        return

    rec.count_status = "counting"
    client = CountingClient(config.counting_worker.control_socket_path)
    try:
        resp = client.count(
            uuid=rec.uuid,
            video_path=rec.file_path,
            jsonl_path=_jsonl_path_for(rec),
            engine_path=engine_path,
            target_class=count_config.get("target_class"),
            count_mode=count_config["count_mode"],
            threshold=count_config["threshold"],
            direction=count_config["direction"],
            roi_mode=count_config["roi_mode"],
            confidence=count_config["confidence"],
            started_epoch=iso_to_epoch(rec.started_at),
            fps=rec.fps,
        )
    except CountingWorkerUnavailable as exc:
        rec.count_status = "error"
        rec.count_error = "counting worker no disponible"
        logger.warning("Counting worker unavailable for %s: %s", rec.uuid, exc)
        return

    if not resp.get("ok"):
        # 'busy' is transient — reconciliation re-enqueues a 'counting' row on
        # the next backend start; for now surface it as error so it's visible.
        rec.count_status = "error"
        rec.count_error = resp.get("error") or "unknown"
        logger.warning("Counting worker rejected %s: %s", rec.uuid, rec.count_error)
