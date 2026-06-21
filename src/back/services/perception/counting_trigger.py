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
from back.models import Category, DetectionModel, Recording
from back.services.perception.counting_client import (
    CountingClient,
    CountingWorkerUnavailable,
)
from back.services.perception.engine_paths import (
    actual_pt_path_for,
    engine_cache_path_for,
    worker_model_path_for,
)

logger = logging.getLogger("counting_trigger")


def resolve_model_label(class_mapping_json: str | None, target_class: str | None) -> str | None:
    """Translate a target class to the raw model label the detector emits.

    Counting compares against ``model.names[cls_id]`` (the model_label, e.g.
    ``person``), NEVER the system_label (e.g. ``Persona``), which exists only for
    display. The session/UI carries the system_label, so resolve it back to its
    model_label via the model's class_mapping. Targets that don't map (already a
    model_label, or a model without a mapping) pass through unchanged.
    """
    if not target_class or not class_mapping_json:
        return target_class
    try:
        mapping = json.loads(class_mapping_json)
    except (json.JSONDecodeError, TypeError):
        return target_class
    for entry in mapping:
        if isinstance(entry, dict):
            ml = entry.get("model_label", "")
            sl = entry.get("system_label") or ml
            if ml and target_class in (sl, ml):
                return ml
    return target_class


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


def _worker_path_for_runtime(model, runtime: str | None) -> str:
    """Path to hand the counting worker for ``model`` under the chosen runtime.

    ``runtime`` forces the format: ``"tensorrt"`` → the cached ``.engine``,
    ``"pytorch"`` → the ``.pt``. ``None`` keeps the automatic engine-vs-pt
    decision (``worker_model_path_for``) used by the live/auto count path.
    Non-bare paths are absolutised (the worker's cwd differs from the backend's).
    The caller validates that a tensorrt path actually exists.
    """
    models_dir = config.storage.models_dir
    if runtime == "tensorrt" and model.file_hash:
        path = engine_cache_path_for(model.filename, model.file_hash, models_dir)
    elif runtime == "pytorch":
        path = actual_pt_path_for(model.filename, model.source, models_dir)
    else:
        return worker_model_path_for(
            model.filename,
            model.source,
            model.file_hash,
            model.tensorrt_enabled,
            model.engine_status,
            models_dir,
        )
    if os.sep in path or path.startswith("."):
        path = os.path.abspath(path)
    return path


async def build_count_config(
    db: AsyncSession,
    target_class: str | None,
    overrides: dict | None = None,
    *,
    model_uuid: str | None = None,
    runtime: str | None = None,
) -> dict:
    """Snapshot the counting config + the chosen model's identity.

    The category (``target_class``) is the deployment hub: by default the detector
    AND the full counting geometry (method + line/direction/ROI/confidence) are
    resolved from ``Category(name=target_class)``. Pass ``model_uuid`` to count
    with a specific model instead — the re-process dialog does this so the chosen
    class fixes its own model. ``runtime`` ("pytorch"/"tensorrt") forces which
    format of that model to run; ``None`` keeps the automatic engine-vs-pt pick.

    ``overrides`` (count_mode/threshold/direction/roi_mode/confidence/method)
    overlay the resolved geometry, so the re-process dialog can run a count with
    per-video parameters the operator reviewed/edited. Keys absent from
    ``overrides`` fall back to the category's geometry, then to the global
    ``config.counting`` seed default.

    Raises RuntimeError("no_category") if the category has no detector to count
    with (default path).
    """
    category = await db.execute(
        select(Category).where(Category.name == target_class)
    )
    cat = category.scalar_one_or_none()

    if model_uuid:
        result = await db.execute(
            select(DetectionModel).where(DetectionModel.uuid == model_uuid)
        )
        model = result.scalars().first()
        if model is None:
            raise RuntimeError("no_category")
    else:
        # Default path: the category names the detector. Supersedes the old
        # selected_label resolution — the category is the single config hub.
        if cat is None or not cat.detection_model_uuid:
            raise RuntimeError("no_category")
        result = await db.execute(
            select(DetectionModel).where(
                DetectionModel.uuid == cat.detection_model_uuid
            )
        )
        model = result.scalars().first()
        if model is None:
            raise RuntimeError("no_category")

    engine_path = _worker_path_for_runtime(model, runtime)
    # Record the runtime that path actually represents, so the replay preview can
    # reconstruct the format selection (derive from the extension, not the input,
    # so the automatic path is reported correctly too).
    resolved_runtime = "tensorrt" if engine_path.endswith(".engine") else "pytorch"
    c = config.counting
    o = overrides or {}

    def _pick(key: str, cat_value, default):
        # override wins, then the category's geometry, then the global seed.
        v = o.get(key)
        if v is not None:
            return v
        return cat_value if cat_value is not None else default

    return {
        "count_mode": _pick("count_mode", getattr(cat, "count_mode", None), c.count_mode),
        "threshold": _pick("threshold", getattr(cat, "threshold", None), c.threshold),
        "direction": _pick("direction", getattr(cat, "direction", None), c.direction),
        "roi_mode": _pick("roi_mode", getattr(cat, "roi_mode", None), c.roi_mode),
        "confidence": _pick(
            "confidence", getattr(cat, "confidence", None), c.confidence_threshold
        ),
        "method": _pick("method", getattr(cat, "method", None), c.method),
        # target_class stays the system_label for display (replay panel / record).
        # target_model_label is what the worker actually counts on (model.names).
        "target_class": target_class,
        "target_model_label": resolve_model_label(model.class_mapping, target_class),
        "model_uuid": model.uuid,
        "model_version": model.version,
        "file_hash": model.file_hash,
        "engine_path": engine_path,
        "runtime": resolved_runtime,
    }


def _system_labels(class_mapping_json: str | None) -> list[str]:
    """system_labels (display labels = category names) declared by a detector."""
    if not class_mapping_json:
        return []
    try:
        mapping = json.loads(class_mapping_json)
    except (json.JSONDecodeError, TypeError):
        return []
    labels: list[str] = []
    for entry in mapping:
        if isinstance(entry, dict):
            label = entry.get("system_label") or entry.get("model_label")
            if label and label not in labels:
                labels.append(label)
    return labels


async def reconcile_categories() -> None:
    """Idempotently seed ``categories`` from the legacy counting setup.

    build_count_config now resolves the detector + geometry from a Category, so
    counting only works for classes that have a category row. To preserve "what's
    countable today" across the reframe, seed one category per currently-countable
    ``(detector, label)``:

    - For the active detector (``selected_label`` set), one category per
      ``system_label`` in its ``class_mapping``, with the method from
      ``counting_methods.json`` (default ``single``) and geometry = column
      defaults (= ``config.counting`` seed).
    - Plus any ``{model_uuid}::{label}`` in ``counting_methods.json`` whose model
      still exists, for labels not already covered.

    Runs in-process at startup (config + the robot-only counting_methods.json
    resolve here, not inside a migration). Never overwrites an existing category
    (server-authoritative rows synced down stay intact).
    """
    from back.database import AsyncSessionLocal
    from back.services import counting_methods
    from back.services import storage

    async with AsyncSessionLocal() as session:
        existing = {
            c.name for c in (await session.execute(select(Category))).scalars().all()
        }
        created = 0

        # 1) The active detector's classes.
        active = (
            await session.execute(
                select(DetectionModel)
                .where(DetectionModel.selected_label.isnot(None))
                .limit(1)
            )
        ).scalars().first()
        if active is not None:
            for label in _system_labels(active.class_mapping):
                if label in existing:
                    continue
                await storage.create_category(
                    session,
                    label,
                    detection_model_uuid=active.uuid,
                    method=counting_methods.read_method(active.uuid, label),
                )
                existing.add(label)
                created += 1

        # 2) Explicit per-object method choices pointing at any model.
        for key, method in counting_methods.read_all().items():
            model_uuid, _, label = key.partition("::")
            if not label or label in existing:
                continue
            model = (
                await session.execute(
                    select(DetectionModel).where(DetectionModel.uuid == model_uuid)
                )
            ).scalars().first()
            if model is None:
                continue
            await storage.create_category(
                session, label, detection_model_uuid=model_uuid, method=method
            )
            existing.add(label)
            created += 1

        if created:
            await session.commit()
            logger.info("Seeded %d categories from legacy counting setup", created)


def _jsonl_path_for(rec: Recording) -> str:
    return os.path.join(os.path.dirname(rec.file_path), f"{rec.uuid}.jsonl")


async def enqueue_count(db: AsyncSession, rec: Recording, count_config: dict) -> None:
    """Persist count_config + mark counting, then hand the job to the worker.

    Worker-unavailable / missing-engine is recorded as count_status='error' so
    the operator isn't blocked and reconciliation/recount can retry. Does NOT
    raise — the caller (stop flow) must not abort on a counting failure.
    """
    # Upgrade old/pinned configs that lack target_model_label: resolve it from
    # the pinned model so re-counting an existing recording (which reproduces the
    # stored count_config) also counts on the model_label, not the system_label.
    if "target_model_label" not in count_config and count_config.get("model_uuid"):
        m = await db.execute(
            select(DetectionModel).where(
                DetectionModel.uuid == count_config["model_uuid"]
            )
        )
        model = m.scalars().first()
        if model is not None:
            count_config["target_model_label"] = resolve_model_label(
                model.class_mapping, count_config.get("target_class")
            )

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
            # The worker counts on the model_label (model.names), not the
            # display-only system_label. Fall back for old configs that predate
            # target_model_label (re-count to repopulate).
            target_class=count_config.get("target_model_label")
            or count_config.get("target_class"),
            count_mode=count_config["count_mode"],
            threshold=count_config["threshold"],
            direction=count_config["direction"],
            roi_mode=count_config["roi_mode"],
            confidence=count_config["confidence"],
            # Old pinned configs predate method → default single.
            method=count_config.get("method", "single"),
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
