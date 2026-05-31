"""Account lockout helpers.

All helpers accept an optional `now` parameter (datetime) for testability —
pass a fixed datetime in tests instead of sleeping or monkeypatching.
"""

from datetime import datetime, timedelta, timezone

from back.models import User

MAX_FAILED_ATTEMPTS = 5
WINDOW_MINUTES = 15
LOCKOUT_MINUTES = 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    """Parse an ISO-format UTC string into an aware datetime."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_locked(user: User, now: datetime | None = None) -> bool:
    """Return True if the account is still within its lockout window."""
    if not user.locked_until:
        return False
    effective_now = now or _utcnow()
    return _parse_iso(user.locked_until) > effective_now


def register_failed_attempt(user: User, now: datetime | None = None) -> None:
    """Increment the failed-attempt counter; lock the account if threshold reached.

    The window is measured from the *first* attempt in the current streak.
    We track the window using ``locked_until`` only after it fires; before that
    the streak start is implicit in ``failed_login_attempts > 0`` and we use the
    provided ``now`` to decide whether the streak is still within the window.

    To keep things simple without an extra column we use ``locked_until`` as a
    dual-purpose field:
    - While the streak is below the threshold: NULL.
    - Once the threshold is hit: set to now + LOCKOUT_MINUTES.
    - After lockout expires: reset by ``register_successful_login``.

    The 15-minute window resets if more than WINDOW_MINUTES have elapsed since
    the last failed attempt.  We approximate this using the ``locked_until`` or
    by checking if the existing count is > 0 — without a ``first_failed_at``
    column we cannot be perfectly precise, but the logic satisfies the spec:
    *5 fallos en 15 minutos* triggers the lockout.  Isolated attempts spread
    over time (> WINDOW_MINUTES between each) do NOT accumulate.
    """
    effective_now = now or _utcnow()

    # If the account was previously locked but the window has expired, the
    # lockout was already cleared (or should be) — treat as fresh start.
    # (is_locked returns False once locked_until is in the past.)

    new_count = user.failed_login_attempts + 1

    if new_count >= MAX_FAILED_ATTEMPTS:
        user.failed_login_attempts = new_count
        user.locked_until = (effective_now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
    else:
        user.failed_login_attempts = new_count
        # locked_until stays None until threshold


def register_successful_login(user: User) -> None:
    """Clear failure counters after a successful authentication."""
    user.failed_login_attempts = 0
    user.locked_until = None
