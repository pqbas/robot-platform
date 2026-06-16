"""Helpers to derive the cache path of a TensorRT engine for a given .pt.

The engine filename bakes the .pt's sha256 in so a re-upload (changing
``DetectionModel.file_hash``) automatically invalidates the cached engine.
"""

from __future__ import annotations

import os


def engine_path_for(pt_path: str, file_hash: str, precision: str = "fp16") -> str:
    """Return the canonical .engine path next to ``pt_path``.

    Example: ``data/robot/models/blueberry.pt`` + hash ``abc123`` →
    ``data/robot/models/blueberry.abc123.fp16.engine``.
    """
    if not file_hash:
        raise ValueError("file_hash is required to compute engine path")
    pt_dir = os.path.dirname(pt_path)
    pt_stem = os.path.splitext(os.path.basename(pt_path))[0]
    return os.path.join(pt_dir, f"{pt_stem}.{file_hash}.{precision}.engine")


def engine_exists(pt_path: str, file_hash: str, precision: str = "fp16") -> bool:
    return os.path.exists(engine_path_for(pt_path, file_hash, precision))


def actual_pt_path_for(filename: str, source: str | None, models_dir: str) -> str:
    """On-disk path to the actual .pt file for a model.

    Library models (``yolo11n.pt`` etc.) live at the backend's working
    directory — that's where ultralytics downloads them by default — so
    the path is the bare filename, resolved relative to cwd.

    Uploaded models live under ``MODELS_DIR``.
    """
    if source == "library":
        return filename
    return os.path.join(models_dir, filename)


def engine_cache_path_for(
    filename: str, file_hash: str, models_dir: str, precision: str = "fp16"
) -> str:
    """Engine cache path. Always under ``models_dir`` regardless of where
    the .pt actually lives, so library and uploaded models share the same
    cache layout."""
    virtual_pt = os.path.join(models_dir, filename)
    return engine_path_for(virtual_pt, file_hash, precision)


def worker_model_path_for(
    filename: str,
    source: str | None,
    file_hash: str | None,
    tensorrt_enabled: bool,
    engine_status: str,
    models_dir: str,
) -> str:
    """Path to hand the inference worker for a model.

    Returns the cached ``.engine`` when TensorRT is enabled and a ready
    engine actually exists on disk; otherwise the ``.pt``. Non-bare paths
    are absolutised because the inference worker's cwd differs from the
    backend's, so a relative ``data/...`` would resolve against the wrong
    root. Bare library filenames are left as-is for ultralytics' own cache
    lookup / auto-download.

    Single source of truth for the engine-vs-pt decision, shared by
    ``select_label`` and the startup/periodic model reconciler.
    """
    path: str | None = None
    if tensorrt_enabled and engine_status == "ready" and file_hash:
        engine_path = engine_cache_path_for(filename, file_hash, models_dir)
        if os.path.exists(engine_path):
            path = engine_path
    if path is None:
        path = actual_pt_path_for(filename, source, models_dir)
    if os.sep in path or path.startswith("."):
        path = os.path.abspath(path)
    return path
