"""Records per-frame detections to a JSONL file during an active recording.

One line per inference call: {"frame": int, "t": float, "dets": [...]}.
The file handle and frame counter live here, decoupled from camera.py and
recordings.py. Thread-safe: record() is called from the inference worker
thread while start()/stop() come from the HTTP request handlers.
"""

import json
import logging
import os
import threading
import time
from typing import IO

logger = logging.getLogger("detection_recorder")

_lock = threading.Lock()
_file: IO | None = None
_uuid: str | None = None
_frame: int = 0


def start(uuid: str, recordings_dir: str) -> None:
    """Open {recordings_dir}/{uuid}.jsonl for writing, resetting the counter.

    Overwrites any existing file (UUID is new each time, so this is rare).
    """
    global _file, _uuid, _frame
    path = os.path.join(recordings_dir, f"{uuid}.jsonl")
    os.makedirs(recordings_dir, exist_ok=True)
    with _lock:
        if _file is not None:
            try:
                _file.close()
            except OSError:
                pass
        _file = open(path, "w")
        _uuid = uuid
        _frame = 0
    logger.info("Detection log started: %s", path)


def stop() -> None:
    """Close the file handle and clear the state. No-op if not active."""
    global _file, _uuid, _frame
    with _lock:
        if _file is not None:
            try:
                _file.close()
            except OSError:
                pass
        _file = None
        _uuid = None
        _frame = 0
    logger.info("Detection log stopped")


def is_active() -> bool:
    """True if a recording is active and detections are being logged."""
    with _lock:
        return _file is not None


def record(detections: list[dict]) -> None:
    """Write one JSONL line for this frame. No-op if no recording is active.

    `detections` are the raw dicts from the inference worker response, each
    with class_name/confidence/bbox/track_id. Serialized to cls/conf/bbox/track_id.
    """
    global _frame
    with _lock:
        if _file is None:
            return
        dets = [
            {
                "cls": d.get("class_name"),
                "conf": d.get("confidence"),
                "bbox": d.get("bbox"),
                "track_id": d.get("track_id"),
            }
            for d in detections
        ]
        line = json.dumps({"frame": _frame, "t": time.time(), "dets": dets})
        _file.write(line + "\n")
        _file.flush()
        _frame += 1
