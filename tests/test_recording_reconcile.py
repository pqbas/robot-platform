"""Tests for startup reconciliation of orphaned recording rows.

Covers the three worker states the reconciler distinguishes (idle, recording,
socket-down) plus the no-op fast path, and that ``file_size_bytes`` is filled
from disk while ``duration_seconds`` stays NULL for interrupted recordings.
"""

import os

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

import back.services.recording_reconcile as reconcile_mod
from back.config import get_device_id
from back.database import AsyncSessionLocal
from back.models import Recording
from back.services.recording_client import RecordingWorkerUnavailable
from back.services.recording_reconcile import reconcile_orphaned_recordings


class _FakeClient:
    """Stand-in for RecordingClient; ``status()`` returns/raises as configured."""

    result: dict | None = None
    exc: Exception | None = None

    def __init__(self, *_args, **_kwargs):
        pass

    def status(self) -> dict:
        if _FakeClient.exc is not None:
            raise _FakeClient.exc
        return _FakeClient.result or {"ok": True, "state": "idle"}


@pytest_asyncio.fixture(autouse=True)
async def _patch_client_and_clean(setup_db, monkeypatch):
    """Patch the worker client and keep the recordings table empty per test."""
    monkeypatch.setattr(reconcile_mod, "RecordingClient", _FakeClient)
    _FakeClient.result = None
    _FakeClient.exc = None
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recording))
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recording))
        await session.commit()


async def _add_recording(**overrides) -> str:
    async with AsyncSessionLocal() as session:
        rec = Recording(
            started_at="2026-08-14T17:50:37Z",
            file_path=overrides.pop("file_path", "/nonexistent/x.mp4"),
            **overrides,
        )
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        return rec.uuid


async def _get(uuid: str) -> Recording:
    async with AsyncSessionLocal() as session:
        return (
            await session.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one()


@pytest.mark.asyncio
async def test_idle_worker_closes_orphan(tmp_path):
    mp4 = tmp_path / "rec.mp4"
    mp4.write_bytes(b"\x00" * 1234)
    uuid = await _add_recording(file_path=str(mp4))
    _FakeClient.result = {"ok": True, "state": "idle"}

    await reconcile_orphaned_recordings()

    rec = await _get(uuid)
    assert rec.ended_at is not None
    assert rec.file_size_bytes == 1234
    # An interrupted recording's true length is unknown.
    assert rec.duration_seconds is None


@pytest.mark.asyncio
async def test_active_recording_left_open_other_closed():
    active = await _add_recording()
    orphan = await _add_recording()
    _FakeClient.result = {"ok": True, "state": "recording", "uuid": active}

    await reconcile_orphaned_recordings()

    assert (await _get(active)).ended_at is None       # genuinely recording
    assert (await _get(orphan)).ended_at is not None    # stale → closed


@pytest.mark.asyncio
async def test_worker_unavailable_closes_orphan():
    uuid = await _add_recording()
    _FakeClient.exc = RecordingWorkerUnavailable("socket missing")

    await reconcile_orphaned_recordings()

    assert (await _get(uuid)).ended_at is not None


@pytest.mark.asyncio
async def test_missing_file_sets_size_zero():
    uuid = await _add_recording(file_path="/nonexistent/gone.mp4")
    _FakeClient.result = {"ok": True, "state": "idle"}

    await reconcile_orphaned_recordings()

    rec = await _get(uuid)
    assert rec.ended_at is not None
    assert rec.file_size_bytes == 0


@pytest.mark.asyncio
async def test_no_open_rows_is_noop():
    closed = await _add_recording(ended_at="2026-08-14T18:00:00Z")

    # Should not touch the already-closed row nor raise.
    await reconcile_orphaned_recordings()

    assert (await _get(closed)).ended_at == "2026-08-14T18:00:00Z"


@pytest.mark.asyncio
async def test_only_this_device_rows_are_touched():
    mine = await _add_recording()
    other = await _add_recording(device_id="some-other-device")
    _FakeClient.result = {"ok": True, "state": "idle"}

    await reconcile_orphaned_recordings()

    assert (await _get(mine)).ended_at is not None
    # A different device's open row is out of scope for this robot.
    assert (await _get(other)).ended_at is None
    assert get_device_id() != "some-other-device"
