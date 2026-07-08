"""Build the classification_config snapshot + enqueue an offline classification.

Post-counting ripeness classification runs ONLY when the counted category has a
classifier assigned; otherwise it is a no-op (zero cost, status stays 'none').
Shared by the counting poller (auto, right after a count finishes) and
``recordings.py::reclassify`` (manual re-run).

The video + its `{uuid}.crossings.jsonl` are the source of truth;
classification_config pins the classifier identity (uuid/version/file_hash/
model_path) so a reclassify months later doesn't silently use a different model.
"""

from __future__ import annotations

import json
import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.models import Category, ClassificationModel, Recording
from back.services.perception.classification_client import (
    ClassificationClient,
    ClassificationWorkerUnavailable,
)

logger = logging.getLogger("classification_trigger")


def crossings_path_for(rec: Recording) -> str:
    return os.path.join(os.path.dirname(rec.file_path), f"{rec.uuid}.crossings.jsonl")


def classifications_path_for(rec: Recording) -> str:
    return os.path.join(
        os.path.dirname(rec.file_path), f"{rec.uuid}.classifications.jsonl"
    )


def crops_dir_for(rec: Recording) -> str:
    # Crops are heavy JPGs; keep them under a per-recording subdir next to the MP4
    # so deleting a recording's directory cleans them up too.
    return os.path.join(os.path.dirname(rec.file_path), "crops", rec.uuid)


def _classifier_path_for(model: ClassificationModel) -> str:
    """On-disk path to the classifier .npz. Uploaded/synced classifiers live
    under MODELS_DIR (same convention as uploaded detectors). Absolutised because
    the worker's cwd differs from the backend's."""
    path = os.path.join(config.storage.models_dir, model.filename)
    return os.path.abspath(path)


async def build_classification_config(
    db: AsyncSession, rec: Recording
) -> dict | None:
    """Snapshot the classifier pin for ``rec``, or None if it should not run.

    Returns None (skip, no error) when: the recording has no count_config /
    target_class, the category has no classifier assigned, or the pinned
    ClassificationModel row is missing. Returning None keeps classification_status
    at 'none' — classification is opt-in per category.
    """
    if not rec.count_config:
        return None
    try:
        cc = json.loads(rec.count_config)
    except (json.JSONDecodeError, TypeError):
        return None
    target_class = cc.get("target_class")
    if not target_class:
        return None

    cat = (
        await db.execute(select(Category).where(Category.name == target_class))
    ).scalar_one_or_none()
    if cat is None or not cat.classification_model_uuid:
        return None

    model = (
        await db.execute(
            select(ClassificationModel).where(
                ClassificationModel.uuid == cat.classification_model_uuid
            )
        )
    ).scalar_one_or_none()
    if model is None:
        return None

    return {
        "model_uuid": model.uuid,
        "model_version": model.version,
        "file_hash": model.file_hash,
        "model_path": _classifier_path_for(model),
        "class_names": model.class_names,
        "latent_dim": model.latent_dim,
        "imgsz": model.imgsz,
        "target_class": target_class,
    }


async def enqueue_classification(
    db: AsyncSession, rec: Recording, classification_config: dict | None = None
) -> None:
    """Persist classification_config + mark classifying, then hand off to worker.

    ``classification_config`` reproduces a pin (reclassify); when None it is built
    fresh from the category. If the category has no classifier this is a silent
    no-op. Worker-unavailable / missing model / missing crossings is recorded as
    classification_status='error' so the operator isn't blocked. Does NOT raise —
    a classification failure must never abort the count flow.
    """
    cfg = classification_config or await build_classification_config(db, rec)
    if cfg is None:
        # Category has no classifier (or no count). Nothing to do; leave status.
        return

    model_path = cfg.get("model_path") or ""
    crossings_path = crossings_path_for(rec)

    if not model_path or (os.sep in model_path and not os.path.exists(model_path)):
        rec.classification_status = "error"
        rec.classification_error = f"clasificador no disponible: {model_path}"
        rec.classification_config = json.dumps(cfg)
        logger.warning("Classification not enqueued for %s: missing model", rec.uuid)
        return
    if not os.path.isfile(crossings_path):
        rec.classification_status = "error"
        rec.classification_error = "crossings.jsonl no encontrado (¿conteo viejo?)"
        rec.classification_config = json.dumps(cfg)
        logger.warning("Classification not enqueued for %s: no crossings", rec.uuid)
        return

    rec.classification_config = json.dumps(cfg)
    rec.classification_error = None
    rec.classification_status = "classifying"

    client = ClassificationClient(config.classification_worker.control_socket_path)
    try:
        resp = client.classify(
            uuid=rec.uuid,
            video_path=rec.file_path,
            crossings_path=crossings_path,
            classifications_path=classifications_path_for(rec),
            crops_dir=crops_dir_for(rec),
            model_path=model_path,
        )
    except ClassificationWorkerUnavailable as exc:
        rec.classification_status = "error"
        rec.classification_error = "classification worker no disponible"
        logger.warning("Classification worker unavailable for %s: %s", rec.uuid, exc)
        return

    if not resp.get("ok"):
        rec.classification_status = "error"
        rec.classification_error = resp.get("error") or "unknown"
        logger.warning(
            "Classification worker rejected %s: %s", rec.uuid, rec.classification_error
        )
