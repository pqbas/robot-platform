import logging
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger("counter")


@dataclass
class CountingSession:
    session_id: int
    camellon_id: int
    target_class: str
    start_time: str
    last_frame_count: int = 0


_active: CountingSession | None = None


def start_session(session_id: int, camellon_id: int, target_class: str) -> CountingSession:
    global _active
    if _active is not None:
        raise RuntimeError("A counting session is already active")
    _active = CountingSession(
        session_id=session_id,
        camellon_id=camellon_id,
        target_class=target_class,
        start_time=datetime.now(timezone.utc).isoformat(),
    )
    logger.info("Counting session %d started (target=%s)", session_id, target_class)
    return _active


def stop_session() -> tuple[int, int]:
    """Stop active session. Returns (session_id, last_frame_count)."""
    global _active
    if _active is None:
        raise RuntimeError("No counting session is active")
    result = (_active.session_id, _active.last_frame_count)
    logger.info(
        "Counting session %d stopped (count=%d)", _active.session_id, _active.last_frame_count
    )
    _active = None
    return result


def get_active_session() -> CountingSession | None:
    return _active


def is_session_active() -> bool:
    return _active is not None


def update(count: int) -> None:
    """Called every frame to update the running count."""
    if _active is not None:
        _active.last_frame_count = count
