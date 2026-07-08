"""DB-backed sync tests for ripeness classification.

Covers the two pieces that move classification from robot to server:
- ``receive_recordings`` upserts the classification metadata fields.
- ``transcribe_classifications`` turns a ``{uuid}.classifications.jsonl`` sidecar
  into fruit_crops/fruit_classifications rows, idempotently.

Run: PYTHONPATH=src python -m pytest src/back/tests/test_classification_sync_db.py
"""

import json

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from back.models import Base, FruitClassification, FruitCrop, Recording
from back.schemas import SyncRecording
from back.services import sync_receive
from back.services.perception import classification_ingest
from back.services.sync_receive import receive_recordings


@pytest_asyncio.fixture
async def sessionmaker(tmp_path, monkeypatch):
    """A file-backed sqlite async DB with the full schema. File (not :memory:)
    so the separate connections opened by transcribe_classifications and the
    assertions share the same data. Patches the module-global AsyncSessionLocal
    used by transcribe_classifications."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/test.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(classification_ingest, "AsyncSessionLocal", maker)
    yield maker
    await engine.dispose()


def _rec(tmp_path, uuid="rec1"):
    return Recording(
        uuid=uuid,
        device_id="dev1",
        started_at="2026-07-07T10:00:00Z",
        ended_at="2026-07-07T10:01:00Z",
        file_path=str(tmp_path / f"{uuid}.mp4"),
        classification_config=json.dumps({"model_uuid": "model-abc"}),
    )


@pytest.mark.asyncio
async def test_receive_recordings_inserts_and_upserts_classification(sessionmaker):
    async with sessionmaker() as db:
        item = SyncRecording(
            uuid="rec-cls",
            device_id="dev1",
            started_at="2026-07-07T10:00:00Z",
            ended_at="2026-07-07T10:01:00Z",
            file_path="/srv/rec-cls.mp4",
            classification_status="done",
            classification_config='{"model_uuid": "m1"}',
        )
        res = await receive_recordings(db, [item], "dev1")
        assert res.inserted == 1

        row = (
            await db.execute(select(Recording).where(Recording.uuid == "rec-cls"))
        ).scalar_one()
        assert row.classification_status == "done"
        assert row.classification_config == '{"model_uuid": "m1"}'

        # Re-push with a new status → upsert (skipped path), not ignored.
        item.classification_status = "error"
        item.classification_error = "boom"
        res2 = await receive_recordings(db, [item], "dev1")
        assert res2.skipped == 1
        await db.refresh(row)
        assert row.classification_status == "error"
        assert row.classification_error == "boom"


@pytest.mark.asyncio
async def test_transcribe_classifications_populates_and_is_idempotent(
    sessionmaker, tmp_path
):
    rec = _rec(tmp_path)
    # The sidecar the classification-worker writes next to the MP4.
    sidecar = tmp_path / "rec1.classifications.jsonl"
    sidecar.write_text(
        "\n".join(
            json.dumps(d)
            for d in [
                {"track_id": 1, "frame": 10, "label": "AZUL",
                 "confidence": 0.9, "bbox": [0, 0, 10, 10], "crop": "1_10.jpg"},
                {"track_id": 2, "frame": 20, "label": "ROSADO",
                 "confidence": 0.8, "bbox": [5, 5, 15, 15], "crop": "2_20.jpg"},
                {"track_id": 3, "frame": 30, "label": "AZUL",
                 "confidence": 0.7, "bbox": [1, 1, 9, 9], "crop": "3_30.jpg"},
            ]
        )
        + "\n"
    )

    written = await classification_ingest.transcribe_classifications(rec)
    assert written == 3

    async with sessionmaker() as db:
        crops = (await db.execute(func.count(FruitCrop.uuid))).scalar()
        cls = (await db.execute(func.count(FruitClassification.uuid))).scalar()
        assert crops == 3
        assert cls == 3
        labels = (
            await db.execute(select(FruitClassification.class_name))
        ).scalars().all()
        assert sorted(labels) == ["AZUL", "AZUL", "ROSADO"]
        # image_path lands under crops_dir_for(rec) (next to the MP4).
        one = (await db.execute(select(FruitCrop).limit(1))).scalar_one()
        assert "crops/rec1/" in one.image_path.replace("\\", "/")

    # Idempotent: a second run deletes the prior batch and re-inserts, no dupes.
    written2 = await classification_ingest.transcribe_classifications(rec)
    assert written2 == 3
    async with sessionmaker() as db:
        assert (await db.execute(func.count(FruitCrop.uuid))).scalar() == 3
        assert (await db.execute(func.count(FruitClassification.uuid))).scalar() == 3


def test_sync_receive_module_importable():
    # Guard against an accidental import cycle from the new fields.
    assert hasattr(sync_receive, "receive_recordings")
