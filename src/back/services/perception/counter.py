import logging
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger("counter")


@dataclass
class CountingSession:
    target_class: str
    start_time: str
    # Kept for the status/stream payloads, but no longer accumulated live: the
    # authoritative number is computed offline by the counting-worker. Stays 0.
    last_frame_count: int = 0
    recording_uuid: str | None = None


_active: CountingSession | None = None
# recording_uuid of the last stopped session, so save/update can still link
# the recording after the session is cleared.
_last_recording_uuid: str | None = None


def start_counting(target_class: str) -> CountingSession:
    """Start a counting session (marker only).

    The session marks that counting is active — it triggers the auto-recording
    and enables live inference for the visual overlay — but it no longer counts
    in real time. The count is recomputed offline from the recorded MP4 by the
    counting-worker, so there is no live ``ObjectCounter`` here.
    """
    global _active
    if _active is not None:
        raise RuntimeError("A counting session is already active")
    _active = CountingSession(
        target_class=target_class,
        start_time=datetime.now(timezone.utc).isoformat(),
    )
    logger.info("Counting started (target=%s)", target_class)
    return _active


def stop_counting() -> tuple[int, str]:
    """Stop the counting session. Returns (0, target_class).

    The total is always 0 — the authoritative count arrives later via the
    offline worker + poller backfill of ``Session.total_count``.
    """
    global _active, _last_recording_uuid
    if _active is None:
        raise RuntimeError("No counting session is active")

    target_class = _active.target_class
    logger.info("Counting stopped (target=%s); offline count pending", target_class)
    _last_recording_uuid = _active.recording_uuid
    _active = None
    return 0, target_class


def get_active_session() -> CountingSession | None:
    return _active


def get_last_recording_uuid() -> str | None:
    return _last_recording_uuid


def clear_last_recording_uuid() -> None:
    global _last_recording_uuid
    _last_recording_uuid = None


def is_session_active() -> bool:
    return _active is not None
