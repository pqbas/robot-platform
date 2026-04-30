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
