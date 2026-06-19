"""Tests for the offline counting poller + reconciler + recount endpoint.

These exercise the DB-transcription logic only (no worker socket): the poller
turns a worker ``last_result`` into Recording/Session state, the reconciler
fails orphaned rows whose MP4/engine vanished, and the recount endpoint
validates its inputs. The worker round-trip itself is a manual check.
"""

import json

import pytest
from fastapi import HTTPException

from back.database import AsyncSessionLocal
from back.models import Recording, Session
from back.routes.recordings import recount
from back.services.perception import counting_poller


def _now():
    return "2026-06-15T00:00:00Z"


async def _add_recording(uuid: str, **kw) -> None:
    async with AsyncSessionLocal() as s:
        s.add(
            Recording(
                uuid=uuid,
                device_id="dev",
                started_at=_now(),
                ended_at=_now(),
                file_path=kw.pop("file_path", f"/tmp/nope/{uuid}.mp4"),
                **kw,
            )
        )
        await s.commit()


async def _get_recording(uuid: str) -> Recording:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(Recording.__table__.select().where(Recording.uuid == uuid))
        ).first()


@pytest.mark.asyncio
async def test_poller_transcribes_done_and_backfills_session(setup_db):
    await _add_recording("rec-done", count_status="counting")
    async with AsyncSessionLocal() as s:
        s.add(
            Session(
                camellon_id=1,
                start_time=_now(),
                target_class="blueberry",
                total_count=0,
                recording_uuid="rec-done",
            )
        )
        await s.commit()

    await counting_poller._process_worker_result(
        {"ok": True, "uuid": "rec-done", "total_count": 42, "finished_at": _now()}
    )

    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(
                Recording.__table__.select().where(Recording.uuid == "rec-done")
            )
        ).mappings().first()
        assert rec["count_status"] == "done"
        assert rec["count"] == 42
        sess = (
            await s.execute(
                Session.__table__.select().where(
                    Session.recording_uuid == "rec-done"
                )
            )
        ).mappings().first()
        assert sess["total_count"] == 42


@pytest.mark.asyncio
async def test_poller_transcribes_error(setup_db):
    await _add_recording("rec-err", count_status="counting")

    await counting_poller._process_worker_result(
        {"ok": False, "uuid": "rec-err", "error": "boom", "finished_at": _now()}
    )

    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(
                Recording.__table__.select().where(Recording.uuid == "rec-err")
            )
        ).mappings().first()
        assert rec["count_status"] == "error"
        assert rec["count_error"] == "boom"


@pytest.mark.asyncio
async def test_poller_ignores_non_counting_row(setup_db):
    # A row already 'done' must not be clobbered by a stale/duplicate result.
    await _add_recording("rec-stable", count_status="done", count=7)
    await counting_poller._process_worker_result(
        {"ok": True, "uuid": "rec-stable", "total_count": 999, "finished_at": _now()}
    )
    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(
                Recording.__table__.select().where(Recording.uuid == "rec-stable")
            )
        ).mappings().first()
        assert rec["count"] == 7  # unchanged


@pytest.mark.asyncio
async def test_reconcile_marks_error_when_mp4_missing(setup_db):
    await _add_recording(
        "rec-orphan",
        count_status="counting",
        count_config=json.dumps({"engine_path": "/tmp/x.engine"}),
        file_path="/tmp/does-not-exist/rec-orphan.mp4",
    )

    await counting_poller.reconcile_orphaned_counts()

    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(
                Recording.__table__.select().where(Recording.uuid == "rec-orphan")
            )
        ).mappings().first()
        assert rec["count_status"] == "error"
        assert "MP4" in (rec["count_error"] or "")


@pytest.mark.asyncio
async def test_reconcile_marks_error_when_no_config(setup_db):
    await _add_recording("rec-noconf", count_status="counting", count_config=None)

    await counting_poller.reconcile_orphaned_counts()

    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(
                Recording.__table__.select().where(Recording.uuid == "rec-noconf")
            )
        ).mappings().first()
        assert rec["count_status"] == "error"


@pytest.mark.asyncio
async def test_recount_404_unknown_uuid(setup_db):
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as ei:
            await recount("nope", False, s)
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_recount_409_mp4_missing(setup_db):
    await _add_recording("rec-recount", count_status="done", count=1)
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as ei:
            await recount("rec-recount", False, s)
    assert ei.value.status_code == 409
