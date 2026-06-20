"""Background reconciler + poller for offline counting jobs.

Two responsibilities (mirrors ``conversion_poller``):

1. **Startup reconciliation.** Any ``Recording`` stuck in
   ``count_status='counting'`` at startup is orphaned — the counting-worker is
   a separate process and was idle when the backend booted. Re-enqueue it if
   the MP4 and the pinned engine still exist; otherwise mark ``error``.

2. **Async poller.** While at least one recording is ``counting``, poll
   ``CountingClient.status()`` every 5 s. When the worker reports a
   ``last_result``, transcribe it to DB (``done`` + ``count`` or ``error``) and
   backfill ``Session.total_count`` for the linked session.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from sqlalchemy import delete, select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import Recording, Session, SyncLog
from back.services.perception.counting_client import (
    CountingClient,
    CountingWorkerUnavailable,
)
from back.services.perception.counting_trigger import enqueue_count

logger = logging.getLogger("counting_poller")

POLL_INTERVAL_SECONDS = 5.0


async def reconcile_orphaned_counts() -> None:
    """At backend startup, re-enqueue or fail any orphaned 'counting' row."""
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(Recording).where(Recording.count_status == "counting")
            )
        ).scalars().all()
        if not rows:
            return
        for rec in rows:
            cfg = None
            if rec.count_config:
                try:
                    cfg = json.loads(rec.count_config)
                except json.JSONDecodeError:
                    cfg = None
            if cfg is None:
                rec.count_status = "error"
                rec.count_error = "count_config ausente o inválido"
                continue
            if not os.path.isfile(rec.file_path):
                rec.count_status = "error"
                rec.count_error = "MP4 no encontrado"
                continue
            engine_path = cfg.get("engine_path") or ""
            if (
                os.sep in engine_path
                and not os.path.exists(engine_path)
            ):
                rec.count_status = "error"
                rec.count_error = f"engine no disponible: {engine_path}"
                continue
            logger.info("Re-encolando conteo huérfano: %s", rec.uuid)
            await enqueue_count(session, rec, cfg)
        await session.commit()


async def _process_worker_result(last_result: dict) -> None:
    """Transcribe a worker last_result into the matching Recording (by uuid)."""
    uuid = last_result.get("uuid")
    if not uuid:
        return
    async with AsyncSessionLocal() as session:
        rec = (
            await session.execute(
                select(Recording).where(Recording.uuid == uuid)
            )
        ).scalar_one_or_none()
        if rec is None or rec.count_status != "counting":
            # Already transcribed, recount superseded, or unknown uuid.
            return

        if last_result.get("ok"):
            rec.count = last_result.get("total_count")
            rec.count_status = "done"
            rec.count_error = None
            # Backfill the authoritative number onto any linked session.
            sessions = (
                await session.execute(
                    select(Session).where(Session.recording_uuid == uuid)
                )
            ).scalars().all()
            for s in sessions:
                s.total_count = rec.count
                # The count is computed after the first sync, and sync is
                # insert-only — so drop the session's sync_log row to re-queue
                # it. The next periodic cycle re-pushes it with the
                # authoritative number automatically (server upserts
                # total_count); no manual sync-button press needed.
                await session.execute(
                    delete(SyncLog).where(
                        (SyncLog.table_name == "sessions")
                        & (SyncLog.record_uuid == s.uuid)
                    )
                )
            logger.info("Conteo listo %s: %s", uuid, rec.count)
        else:
            rec.count_status = "error"
            rec.count_error = last_result.get("error") or "unknown"
            logger.warning("Conteo falló %s: %s", uuid, rec.count_error)
        await session.commit()


async def run_poller() -> None:
    """Loop forever. Cheap when nothing is counting (one DB query per tick);
    does the worker round-trip only when at least one row is ``counting``."""
    seen_finished_at: str | None = None
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            async with AsyncSessionLocal() as session:
                counting = (
                    await session.execute(
                        select(Recording).where(
                            Recording.count_status == "counting"
                        )
                    )
                ).scalars().all()
            if not counting:
                continue

            client = CountingClient(config.counting_worker.control_socket_path)
            try:
                status = client.status()
            except CountingWorkerUnavailable as exc:
                logger.warning("Counting worker unreachable: %s", exc)
                continue

            last = status.get("last_result")
            if not last:
                continue
            finished_at = last.get("finished_at")
            if finished_at and finished_at == seen_finished_at:
                continue

            await _process_worker_result(last)
            if finished_at:
                seen_finished_at = finished_at
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Counting poller iteration failed")
