"""Tests for the post-count classification lifecycle (Group 4).

Cover the opt-in resolution (build_classification_config returns None unless the
counted category has a classifier) and the poller transcription of the worker's
``{uuid}.classifications.jsonl`` into FruitCrop + FruitClassification rows
(idempotent on reclassify).
"""

import json
import os

import pytest

from sqlalchemy import delete, select

from back.database import AsyncSessionLocal
from back.models import (
    Category,
    ClassificationModel,
    FruitClassification,
    FruitCrop,
    Recording,
)
from back.services import storage
from back.services.perception.classification_poller import (
    _process_worker_result,
    _transcribe_results,
    reconcile_orphaned_classifications,
)
from back.services.perception.classification_trigger import (
    build_classification_config,
)


async def _wipe() -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(delete(FruitClassification))
        await s.execute(delete(FruitCrop))
        await s.execute(delete(Category))
        await s.execute(delete(ClassificationModel))
        await s.commit()


def _rec(uuid: str, *, file_path: str, target_class: str | None, **cfg_extra) -> Recording:
    count_config = None
    if target_class is not None:
        count_config = json.dumps({"target_class": target_class})
    return Recording(
        uuid=uuid,
        started_at="2026-06-20T00:00:00Z",
        file_path=file_path,
        count_status="done",
        count_config=count_config,
        **cfg_extra,
    )


@pytest.mark.asyncio
async def test_config_none_without_count_config(setup_db):
    await _wipe()
    rec = _rec("r1", file_path="/tmp/r1.mp4", target_class=None)
    async with AsyncSessionLocal() as s:
        assert await build_classification_config(s, rec) is None


@pytest.mark.asyncio
async def test_config_none_when_category_has_no_classifier(setup_db):
    await _wipe()
    async with AsyncSessionLocal() as s:
        await storage.create_category(s, "arandano", detection_model_uuid=None)
        await s.commit()
    rec = _rec("r2", file_path="/tmp/r2.mp4", target_class="arandano")
    async with AsyncSessionLocal() as s:
        assert await build_classification_config(s, rec) is None


@pytest.mark.asyncio
async def test_config_pins_classifier_when_assigned(setup_db):
    await _wipe()
    async with AsyncSessionLocal() as s:
        model = await storage.create_classification_model(
            s,
            version="v1",
            filename="classifier.npz",
            file_hash="abc123",
            class_names=["AZUL", "VERDE"],
            latent_dim=64,
            imgsz=128,
        )
        await storage.create_category(
            s,
            "arandano",
            detection_model_uuid=None,
            classification_model_uuid=model.uuid,
        )
        await s.commit()
        model_uuid = model.uuid

    rec = _rec("r3", file_path="/tmp/r3.mp4", target_class="arandano")
    async with AsyncSessionLocal() as s:
        cfg = await build_classification_config(s, rec)

    assert cfg is not None
    assert cfg["model_uuid"] == model_uuid
    assert cfg["file_hash"] == "abc123"
    assert cfg["latent_dim"] == 64
    assert cfg["imgsz"] == 128
    assert cfg["target_class"] == "arandano"
    assert cfg["model_path"].endswith("classifier.npz")
    assert os.path.isabs(cfg["model_path"])


@pytest.mark.asyncio
async def test_transcribe_results_creates_crops_and_is_idempotent(setup_db, tmp_path):
    await _wipe()
    uuid = "r4"
    mp4 = tmp_path / f"{uuid}.mp4"
    mp4.write_bytes(b"")
    sidecar = tmp_path / f"{uuid}.classifications.jsonl"
    sidecar.write_text(
        "\n".join(
            json.dumps(
                {
                    "track_id": tid,
                    "frame": fr,
                    "pts": fr * 0.03,
                    "bbox": [10, 20, 40, 60],
                    "det_cls": "arandano",
                    "label": label,
                    "confidence": 0.9,
                    "crop": f"{tid}_{fr}.jpg",
                }
            )
            for tid, fr, label in [(1, 0, "AZUL"), (2, 3, "VERDE"), (3, 5, "AZUL")]
        )
        + "\n"
    )

    rec = _rec(
        uuid,
        file_path=str(mp4),
        target_class="arandano",
        classification_config=json.dumps({"model_uuid": "m-1"}),
    )

    written = await _transcribe_results(rec)
    assert written == 3

    async with AsyncSessionLocal() as s:
        crops = (
            await s.execute(select(FruitCrop).where(FruitCrop.recording_uuid == uuid))
        ).scalars().all()
        cls = (await s.execute(select(FruitClassification))).scalars().all()
    assert len(crops) == 3
    assert len(cls) == 3
    # bbox [x1,y1,x2,y2] -> x,y,w,h
    one = next(c for c in crops if c.track_id == 1)
    assert (one.bbox_x, one.bbox_y, one.bbox_w, one.bbox_h) == (10, 20, 30, 40)
    assert {c.class_name for c in cls} == {"AZUL", "VERDE"}
    assert all(c.model_uuid == "m-1" for c in cls)

    # Re-running replaces, never duplicates.
    written2 = await _transcribe_results(rec)
    assert written2 == 3
    async with AsyncSessionLocal() as s:
        crops2 = (
            await s.execute(select(FruitCrop).where(FruitCrop.recording_uuid == uuid))
        ).scalars().all()
        cls2 = (await s.execute(select(FruitClassification))).scalars().all()
    assert len(crops2) == 3
    assert len(cls2) == 3


async def _persist_rec(uuid: str, *, file_path: str, status: str, cfg: dict | None) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(delete(Recording).where(Recording.uuid == uuid))
        s.add(
            Recording(
                uuid=uuid,
                started_at="2026-06-20T00:00:00Z",
                file_path=file_path,
                count_status="done",
                classification_status=status,
                classification_config=json.dumps(cfg) if cfg else None,
            )
        )
        await s.commit()


@pytest.mark.asyncio
async def test_process_worker_result_ok_marks_done_and_creates_rows(setup_db, tmp_path):
    await _wipe()
    uuid = "p-ok"
    mp4 = tmp_path / f"{uuid}.mp4"
    mp4.write_bytes(b"")
    (tmp_path / f"{uuid}.classifications.jsonl").write_text(
        json.dumps(
            {
                "track_id": 1,
                "frame": 0,
                "bbox": [0, 0, 10, 10],
                "label": "AZUL",
                "confidence": 0.8,
                "crop": "1_0.jpg",
            }
        )
        + "\n"
    )
    await _persist_rec(uuid, file_path=str(mp4), status="classifying", cfg={"model_uuid": "m-1"})

    await _process_worker_result({"ok": True, "uuid": uuid, "finished_at": "x"})

    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one()
        crops = (
            await s.execute(select(FruitCrop).where(FruitCrop.recording_uuid == uuid))
        ).scalars().all()
    assert rec.classification_status == "done"
    assert rec.classification_error is None
    assert rec.classifications_uploaded_at is None  # dirty → needs upload
    assert len(crops) == 1


@pytest.mark.asyncio
async def test_process_worker_result_error_sets_error(setup_db, tmp_path):
    await _wipe()
    uuid = "p-err"
    await _persist_rec(uuid, file_path=str(tmp_path / f"{uuid}.mp4"), status="classifying", cfg={"model_uuid": "m"})
    await _process_worker_result({"ok": False, "uuid": uuid, "error": "boom"})
    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one()
    assert rec.classification_status == "error"
    assert rec.classification_error == "boom"


@pytest.mark.asyncio
async def test_process_worker_result_does_not_touch_done_rows(setup_db, tmp_path):
    await _wipe()
    uuid = "p-done"
    await _persist_rec(uuid, file_path=str(tmp_path / f"{uuid}.mp4"), status="done", cfg={"model_uuid": "m"})
    # An error result for an already-done row must be ignored (guard on status).
    await _process_worker_result({"ok": False, "uuid": uuid, "error": "late"})
    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one()
    assert rec.classification_status == "done"
    assert rec.classification_error is None


@pytest.mark.asyncio
async def test_reconcile_orphaned_classification_missing_mp4_errors(setup_db, tmp_path):
    await _wipe()
    uuid = "orph"
    await _persist_rec(
        uuid,
        file_path=str(tmp_path / "does-not-exist.mp4"),
        status="classifying",
        cfg={"model_uuid": "m", "model_path": str(tmp_path / "m.npz")},
    )
    await reconcile_orphaned_classifications()
    async with AsyncSessionLocal() as s:
        rec = (
            await s.execute(select(Recording).where(Recording.uuid == uuid))
        ).scalar_one()
    assert rec.classification_status == "error"
    assert "MP4" in (rec.classification_error or "")
