"""Persistence for the line-crossing counting config.

Mirrors ``camera_settings``: the config lives in
``data/robot/counting_settings.json`` so the operator's choices (count_mode,
threshold, direction, confidence, roi_mode) survive a backend restart. Without
this the in-memory ``config.counting`` reset to its hardcoded defaults
(horizontal / 0.5 / left2right / 0.25 / square) on every restart, which made it
look like the counter ignored the configured settings.

Flow:
- ``apply_to_config()`` is called once at startup to overlay the persisted
  values onto ``config.counting`` (the hot-path source of truth read per-frame
  in camera.py and when building a deferred-count job in counting_trigger.py).
- ``persist_from_config()`` is called by ``PUT /api/config/counting`` after it
  mutates ``config.counting``, so the change is written through to disk.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Final

from back.config import config

logger = logging.getLogger("counting_settings")

VALID_COUNT_MODES: Final[frozenset[str]] = frozenset({"vertical", "horizontal"})
VALID_DIRECTIONS: Final[frozenset[str]] = frozenset(
    {"top2down", "down2top", "left2right", "right2left"}
)
VALID_ROI_MODES: Final[frozenset[str]] = frozenset({"square", "full"})

# Field name -> validator. Each validator returns True if the persisted value is
# usable; invalid/missing fields fall back to whatever default config.counting
# already holds, so a corrupt file degrades gracefully instead of crashing.
_VALIDATORS: Final[dict] = {
    "count_mode": lambda v: v in VALID_COUNT_MODES,
    "threshold": lambda v: isinstance(v, (int, float)) and 0.0 <= v <= 1.0,
    "direction": lambda v: v in VALID_DIRECTIONS,
    "confidence_threshold": lambda v: isinstance(v, (int, float)) and 0.0 <= v <= 1.0,
    "roi_mode": lambda v: v in VALID_ROI_MODES,
}


def _path() -> str:
    return config.storage.counting_settings_path


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
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("counting_settings %s unreadable (%s) — ignoring", path, exc)
    return {}


def _write_raw(data: dict) -> None:
    """Atomically write *data* to the settings file."""
    path = _path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def apply_to_config() -> None:
    """Overlay persisted, valid fields onto ``config.counting`` (startup only).

    Missing file or invalid values leave the dataclass defaults in place.
    """
    data = _read_raw()
    if not data:
        return
    applied = {}
    for field, is_valid in _VALIDATORS.items():
        if field in data and is_valid(data[field]):
            setattr(config.counting, field, data[field])
            applied[field] = data[field]
    if applied:
        logger.info("counting_settings loaded from %s: %s", _path(), applied)


def persist_from_config() -> None:
    """Write the current ``config.counting`` fields to disk atomically."""
    c = config.counting
    _write_raw(
        {
            "count_mode": c.count_mode,
            "threshold": c.threshold,
            "direction": c.direction,
            "confidence_threshold": c.confidence_threshold,
            "roi_mode": c.roi_mode,
        }
    )
