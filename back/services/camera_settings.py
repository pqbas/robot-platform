"""Persistence for the camera resolution preset (Phase 11).

The preset lives in ``data/robot/camera_settings.json`` (sibling of
``device_context.json``). The camera-worker reads the same file at startup
and on ``{"cmd":"reload"}``, so both processes share a single source of
truth without coordinating through the DB.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Final

from back.config import config

logger = logging.getLogger("camera_settings")

VALID_PRESETS: Final[tuple[str, ...]] = ("1080p", "720p")
DEFAULT_PRESET: Final[str] = "720p"

# Output frame dimensions after the stereo crop (left eye only). Used by the
# counter to translate the normalized threshold (0..1) to pixels.
PRESET_OUTPUT_DIMS: Final[dict[str, tuple[int, int]]] = {
    "1080p": (1920, 1080),
    "720p": (1280, 720),
}


def output_dims_for_active_preset() -> tuple[int, int]:
    return PRESET_OUTPUT_DIMS[read_preset()]


def _path() -> str:
    return config.storage.camera_settings_path


def read_preset() -> str:
    """Return the current preset, falling back to ``DEFAULT_PRESET``.

    Missing file or corrupt JSON both resolve to the default and emit a
    warning. The camera-worker uses the same fallback rule so the two
    processes stay aligned.
    """
    path = _path()
    if not os.path.exists(path):
        return DEFAULT_PRESET
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("camera_settings %s unreadable (%s) — using default", path, exc)
        return DEFAULT_PRESET
    preset = data.get("preset")
    if preset not in VALID_PRESETS:
        logger.warning("camera_settings %s has invalid preset=%r — using default", path, preset)
        return DEFAULT_PRESET
    return preset


def _read_raw() -> dict:
    """Return the raw settings dict, or ``{}`` if missing/corrupt."""
    path = _path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {}


def _write_raw(data: dict) -> None:
    """Atomically write *data* to the settings file."""
    path = _path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def write_preset(preset: str) -> None:
    """Atomically persist the preset, preserving other fields (e.g. rtsp_url).

    Reads the current JSON, merges ``preset`` into it, and writes atomically so
    the camera-worker never observes a half-written file mid-reload.
    """
    if preset not in VALID_PRESETS:
        raise ValueError(f"invalid preset {preset!r}; expected one of {VALID_PRESETS}")
    data = _read_raw()
    data["preset"] = preset
    _write_raw(data)


def read_rtsp_url() -> str:
    """Return the persisted RTSP URL, or ``""`` if missing/corrupt."""
    return _read_raw().get("rtsp_url", "") or ""


def write_rtsp_url(url: str) -> None:
    """Atomically persist *url*, preserving other fields (e.g. preset)."""
    data = _read_raw()
    data["rtsp_url"] = url
    _write_raw(data)
