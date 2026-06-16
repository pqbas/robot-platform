"""Keep the inference worker's loaded model in sync with the DB selection.

The inference worker is stateless on purpose: systemd launches it with a
default ``--model yolo11n.pt`` and it only switches when it receives a
``reload_model`` command (from ``select_label`` or, right after a build,
from the conversion poller). So after any worker restart it silently
falls back to PyTorch ``.pt`` — even when the active model has a ready
TensorRT engine — while the UI, which reads ``engine_status`` from the DB,
keeps showing "TensorRT". That mismatch is the bug this module fixes.

The desired state is fully derivable from the DB: the model holding
``selected_label`` is the active one, and ``worker_model_path_for`` picks
the ``.engine`` when it's ready. We read that and push it to the worker —
once at startup and then periodically, so a worker-only restart (backend
still up) is healed too. The DB stays the single source of truth; nothing
extra is persisted.
"""

from __future__ import annotations

import asyncio
import logging
import os

from sqlalchemy import select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import DetectionModel
from back.services.perception.counter import is_session_active
from back.services.perception.engine_paths import worker_model_path_for
from back.services.perception.inference_client import InferenceClient
from back.services.perception.label_selection import derive_filtered_class_mapping

logger = logging.getLogger("model_reconciler")

RECONCILE_INTERVAL_SECONDS = 20.0


async def _desired_model() -> tuple[str, list] | None:
    """``(worker_path, class_mapping)`` the worker should be running, or
    ``None`` when no model is currently selected (nothing to reconcile)."""
    async with AsyncSessionLocal() as session:
        # Exactly one row should hold selected_label (select_label clears the
        # others), but use first() so a corrupt multi-row state can't crash
        # the reconcile loop.
        row = (
            await session.execute(
                select(DetectionModel)
                .where(DetectionModel.selected_label.isnot(None))
                .limit(1)
            )
        ).scalars().first()
        if row is None:
            return None
        worker_path = worker_model_path_for(
            row.filename,
            row.source,
            row.file_hash,
            row.tensorrt_enabled,
            row.engine_status,
            config.storage.models_dir,
        )
        class_mapping = derive_filtered_class_mapping(
            row.class_mapping, row.selected_label
        )
        return worker_path, class_mapping


def _same_path(a: str, b: str) -> bool:
    return bool(a) and bool(b) and os.path.abspath(a) == os.path.abspath(b)


async def reconcile_active_model_once() -> None:
    """Push the DB's desired model to the worker if it differs from what's
    actually loaded. No-op when nothing is selected or already in sync.

    The blocking socket round-trips run in a thread so the event loop stays
    responsive while the worker (re)loads an engine (a few seconds).

    Guard: never swap the model mid-count. Reloading clears the worker's
    weights for a few seconds, which would drop frames and undercount an
    in-progress session. If a count is active we skip and let the next tick
    reconcile once it finishes."""
    if is_session_active():
        logger.debug("Counting session active — deferring model reconcile")
        return

    desired = await _desired_model()
    if desired is None:
        return
    worker_path, class_mapping = desired

    client = InferenceClient(config.perception.socket_path)
    status = await asyncio.to_thread(client.send_command, "status")
    if not status or not status.get("ok"):
        logger.info("Inference worker not reachable yet — retrying next tick")
        return

    loaded = status.get("model_path") or ""
    if _same_path(loaded, worker_path):
        return  # already running the right backend

    logger.info(
        "Reconciling inference model: worker has %s, loading %s",
        loaded or "(none)",
        worker_path,
    )
    result = await asyncio.to_thread(
        client.reload_model, worker_path, class_mapping
    )
    if not result or not result.get("ok"):
        logger.warning("Reconcile reload failed: %s", result)
    else:
        logger.info("Inference worker now running %s", worker_path)


async def run_model_reconciler() -> None:
    """Loop forever, healing drift between the worker and the DB selection.
    Cheap: one worker ``status`` round-trip per tick, reload only on drift."""
    while True:
        try:
            await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
            await reconcile_active_model_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Model reconciler iteration failed")
