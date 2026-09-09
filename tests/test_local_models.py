"""Tests for the robot-only local model upload/delete endpoints and the
guarantee that a synced pull never removes a locally-uploaded model.

The routes are robot-only (``_require_robot_mode``) and only mounted in robot
mode, so we exercise the route functions directly with an AsyncSessionLocal and
``config.mode`` flipped to ROBOT, rather than through the server-mode test app.
"""

import hashlib
import io

import pytest
import pytest_asyncio
from fastapi import HTTPException
from starlette.datastructures import UploadFile
from sqlalchemy import delete, select

import back.routes.models_local as ml_mod
import back.services.sync_pull as sync_pull_mod
from back.config import AppMode
from back.database import AsyncSessionLocal
from back.models import DetectionModel
from back.routes.models_local import (
    delete_local_model,
    upload_local_model,
)
from back.services.sync_pull import _upsert_models


@pytest_asyncio.fixture(autouse=True)
async def _robot_mode_and_clean(setup_db, monkeypatch, tmp_path):
    """Run in robot mode with an isolated models_dir; empty table per test."""
    monkeypatch.setattr(ml_mod.config, "mode", AppMode.ROBOT)
    monkeypatch.setattr(ml_mod.config.storage, "models_dir", str(tmp_path))
    monkeypatch.setattr(sync_pull_mod.config.storage, "models_dir", str(tmp_path))
    async with AsyncSessionLocal() as session:
        await session.execute(delete(DetectionModel))
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        await session.execute(delete(DetectionModel))
        await session.commit()


def _upload_file(content: bytes, filename: str = "model.pt") -> UploadFile:
    return UploadFile(io.BytesIO(content), filename=filename)


async def _do_upload(session, content: bytes, filename: str, version: str = "v1"):
    """Call the route function with every Form param explicit.

    Calling the endpoint directly (not through FastAPI) means unset ``Form``
    parameters keep their sentinel default instead of resolving to ``None``, so
    each one must be passed here.
    """
    return await upload_local_model(
        version=version,
        class_mapping="[]",
        epochs=None,
        map50=None,
        map50_95=None,
        precision_val=None,
        recall=None,
        dataset_size=None,
        notes=None,
        file=_upload_file(content, filename),
        db=session,
    )


async def _get(uuid: str) -> DetectionModel | None:
    async with AsyncSessionLocal() as session:
        return (
            await session.execute(
                select(DetectionModel).where(DetectionModel.uuid == uuid)
            )
        ).scalar_one_or_none()


# --------------------------------------------------------------------------- #
# upload
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_upload_registers_local_model(tmp_path):
    content = b"fake weights" * 1000
    async with AsyncSessionLocal() as session:
        out = await _do_upload(session, content, "blueberry.pt")

    assert out.source == "local"
    # File landed on disk with the exact bytes and a matching hash.
    dest = tmp_path / "blueberry.pt"
    assert dest.read_bytes() == content

    row = await _get(out.uuid)
    assert row is not None
    assert row.uploaded_by == "robot"
    assert row.is_active is True
    assert row.file_hash == hashlib.sha256(content).hexdigest()


@pytest.mark.asyncio
async def test_upload_rejects_non_pt():
    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc:
            await _do_upload(session, b"x", "model.onnx")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_upload_rejects_path_traversal(tmp_path):
    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc:
            await _do_upload(session, b"x", "../evil.pt")
    assert exc.value.status_code == 400
    # Nothing escaped the models_dir.
    assert not (tmp_path.parent / "evil.pt").exists()


@pytest.mark.asyncio
async def test_upload_duplicate_filename_conflicts():
    async with AsyncSessionLocal() as session:
        await _do_upload(session, b"a", "dup.pt")
    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc:
            await _do_upload(session, b"b", "dup.pt", version="v2")
    assert exc.value.status_code == 409


# --------------------------------------------------------------------------- #
# delete
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_delete_local_removes_row_and_files(tmp_path):
    async with AsyncSessionLocal() as session:
        out = await _do_upload(session, b"weights", "gone.pt")
    pt_path = tmp_path / "gone.pt"
    # Simulate a cached engine next to the .pt.
    engine_path = tmp_path / f"gone.{(await _get(out.uuid)).file_hash}.fp16.engine"
    engine_path.write_bytes(b"engine")
    assert pt_path.exists() and engine_path.exists()

    async with AsyncSessionLocal() as session:
        await delete_local_model(out.uuid, db=session)

    assert await _get(out.uuid) is None
    assert not pt_path.exists()
    assert not engine_path.exists()


@pytest.mark.asyncio
async def test_delete_non_local_is_forbidden():
    async with AsyncSessionLocal() as session:
        model = DetectionModel(
            version="v1",
            filename="server.pt",
            source="uploaded",
            uploaded_by="sync",
        )
        session.add(model)
        await session.commit()
        await session.refresh(model)
        uuid = model.uuid

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc:
            await delete_local_model(uuid, db=session)
    assert exc.value.status_code == 403
    # Row survives.
    assert await _get(uuid) is not None


@pytest.mark.asyncio
async def test_delete_missing_is_404():
    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc:
            await delete_local_model("does-not-exist", db=session)
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# sync preservation (Group 2)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_sync_pull_keeps_local_removes_deassigned(tmp_path):
    """A pull whose remote list omits both rows must keep the local one and
    drop the server-owned one."""
    async with AsyncSessionLocal() as session:
        local = await _do_upload(session, b"local", "local.pt")
    async with AsyncSessionLocal() as session:
        session.add(
            DetectionModel(
                version="v1",
                filename="fromserver.pt",
                source="uploaded",
                uploaded_by="sync",
            )
        )
        await session.commit()

    # Server no longer lists either model.
    await _upsert_models([])

    # Local survives, both row and .pt.
    assert await _get(local.uuid) is not None
    assert (tmp_path / "local.pt").exists()
    # Server-owned deassigned model is gone.
    async with AsyncSessionLocal() as session:
        remaining = (
            await session.execute(
                select(DetectionModel).where(
                    DetectionModel.filename == "fromserver.pt"
                )
            )
        ).scalar_one_or_none()
    assert remaining is None
