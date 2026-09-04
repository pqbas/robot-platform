"""Startup reconciliation for recordings left open by a crash/restart.

A recording row stays open (``ended_at IS NULL``) between ``/start`` and
``/stop``. If the backend or recording-worker dies mid-recording, ``/stop``
never runs and the row stays open forever. That single orphan row makes every
future ``/start`` fail with ``409 "A recording is already in progress"``
(see ``routes/recordings.py``), so recording is silently wedged until someone
clears the row by hand.

At startup we reconcile: any open row the worker is *not* actively recording is
closed, exactly as the route's drift-recovery path does. Mirrors the other
``reconcile_orphaned_*`` reconcilers wired into the robot lifespan.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select

from back.config import config, get_device_id
from back.database import AsyncSessionLocal
from back.models import Recording
from back.services.recording_client import (
    RecordingClient,
    RecordingWorkerUnavailable,
)

logger = logging.getLogger("recording_reconcile")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def reconcile_orphaned_recordings() -> None:
    """Close recording rows left open when the worker is not recording them.

    Two cases are handled at startup:

    - Worker ``idle`` (or socket down): nothing is recording, so every open row
      is an orphan → close it.
    - Worker ``recording`` uuid X: a recording genuinely survived a
      backend-only restart (the worker is a separate systemd unit). Leave row X
      open; close any *other* open row.

    We only close the DB row — we never call ``stop()``. An orphan means the
    worker already abandoned/finalised the file, so ``stop()`` would just return
    ``not_recording``. ``duration_seconds`` is left NULL: an interrupted
    recording's true length is unknown.
    """
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(Recording).where(
                    (Recording.device_id == get_device_id())
                    & (Recording.ended_at.is_(None))
                )
            )
        ).scalars().all()
        if not rows:
            return  # fast path — the common case

        # Ask the worker what (if anything) it is actively recording. The
        # client is synchronous; run it off the event loop so a slow/hung
        # worker (5s timeout) cannot stall startup.
        active_uuid: str | None = None
        try:
            status = await asyncio.to_thread(
                RecordingClient(config.recording.control_socket_path).status
            )
            if status.get("state") == "recording":
                active_uuid = status.get("uuid")
        except RecordingWorkerUnavailable:
            active_uuid = None  # worker down → nothing is recording
        except OSError as exc:
            # Socket up but the call failed — treat as "not recording" so we
            # still heal the orphan rather than leave it wedged.
            logger.warning("Recording worker status failed (%s) — treating as idle", exc)
            active_uuid = None

        for rec in rows:
            if rec.uuid == active_uuid:
                logger.info("Recording %s still active — leaving open", rec.uuid)
                continue
            rec.ended_at = _now_iso()
            try:
                rec.file_size_bytes = (
                    os.path.getsize(rec.file_path)
                    if os.path.isfile(rec.file_path)
                    else 0
                )
            except OSError:
                rec.file_size_bytes = 0
            logger.warning(
                "Closed orphaned recording %s (started_at=%s, size=%s bytes)",
                rec.uuid,
                rec.started_at,
                rec.file_size_bytes,
            )
        await session.commit()
