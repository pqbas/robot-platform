import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from back.config import config
from back.services.perception.object_counter import ObjectCounter

logger = logging.getLogger("counter")


@dataclass
class CountingSession:
    target_class: str
    start_time: str
    last_frame_count: int = 0


_active: CountingSession | None = None
_object_counter: ObjectCounter | None = None
_last_results: list | None = None


def start_counting(target_class: str) -> CountingSession:
    """Start live counting with ObjectCounter. No DB session needed."""
    global _active, _object_counter, _last_results
    if _active is not None:
        raise RuntimeError("A counting session is already active")
    _active = CountingSession(
        target_class=target_class,
        start_time=datetime.now(timezone.utc).isoformat(),
    )
    _object_counter = ObjectCounter(
        count_mode=config.counting.count_mode,
        threshold=config.counting.threshold,
        direction=config.counting.direction,
    )
    _last_results = None
    logger.info("Counting started (target=%s)", target_class)
    return _active


def stop_counting() -> tuple[int, str]:
    """Stop live counting. Returns (total_count, target_class)."""
    global _active, _object_counter, _last_results
    if _active is None or _object_counter is None:
        raise RuntimeError("No counting session is active")

    total = _object_counter.get_count()

    target_class = _active.target_class
    logger.info("Counting stopped (target=%s, count=%d)", target_class, total)
    _active = None
    _object_counter = None
    _last_results = None
    return total, target_class


def get_active_session() -> CountingSession | None:
    return _active


def is_session_active() -> bool:
    return _active is not None


def update(tracking_data: list[dict]) -> None:
    """Called every frame with tracking data to update line-crossing count."""
    global _last_results
    if _active is not None and _object_counter is not None:
        _object_counter.update(tracking_data)
        _active.last_frame_count = _object_counter.get_count()
        _last_results = tracking_data
