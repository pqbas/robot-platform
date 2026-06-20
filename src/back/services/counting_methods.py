"""Per-object counting method persistence.

Unlike ``counting_settings`` (a single global line-crossing config), the counting
*method* is chosen per object type (model + class): ``single`` (the historical
line-crossing) or ``tiled`` (central-strip two-tile crossing, better for
blueberries). The default is always ``single`` so nothing changes until an
operator opts an object into ``tiled``.

Storage mirrors ``counting_settings``: a JSON map in
``data/robot/counting_methods.json`` keyed by ``"{model_uuid}::{label}"`` so the
choice survives a backend restart. Counting is robot-only (the worker lives on
the robot), so a settings file is enough — same pattern as camera/counting
settings.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Final

from back.config import config

logger = logging.getLogger("counting_methods")

VALID_METHODS: Final[frozenset[str]] = frozenset({"single", "tiled"})
DEFAULT_METHOD: Final[str] = "single"


def _path() -> str:
    return config.storage.counting_methods_path


def _key(model_uuid: str, label: str) -> str:
    return f"{model_uuid}::{label}"


def _read_raw() -> dict:
    """Return the raw {key: method} map, or ``{}`` if missing/corrupt."""
    path = _path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("counting_methods %s unreadable (%s) — ignoring", path, exc)
    return {}


def _write_raw(data: dict) -> None:
    """Atomically write *data* to the methods file."""
    path = _path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read_method(model_uuid: str | None, label: str | None) -> str:
    """Method for an object type, or ``single`` if unset/invalid/missing key."""
    if not model_uuid or not label:
        return DEFAULT_METHOD
    value = _read_raw().get(_key(model_uuid, label))
    return value if value in VALID_METHODS else DEFAULT_METHOD


def read_all() -> dict:
    """All persisted {key: method} entries (only valid ones)."""
    return {k: v for k, v in _read_raw().items() if v in VALID_METHODS}


def set_method(model_uuid: str, label: str, method: str) -> None:
    """Persist the method for an object type. ``single`` removes the entry so
    the file only carries non-default choices."""
    if method not in VALID_METHODS:
        raise ValueError(f"invalid method: {method}")
    data = _read_raw()
    key = _key(model_uuid, label)
    if method == DEFAULT_METHOD:
        data.pop(key, None)
    else:
        data[key] = method
    _write_raw(data)
