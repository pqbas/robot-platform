"""Tests for category-centric count-config resolution + the legacy seed.

build_count_config now resolves the detector AND the full counting geometry from
``Category(name=target_class)`` (the deployment hub). These cover: default
resolution, override precedence, the no-category hard-fail, the explicit
model_uuid (recount) branch, and the idempotent startup seed.
"""

import json

import pytest

from sqlalchemy import delete

from back.database import AsyncSessionLocal
from back.models import Category, DetectionModel
from back.services import storage
from back.services.perception.counting_trigger import (
    build_count_config,
    reconcile_categories,
)


async def _wipe_categories_and_models() -> None:
    """Clean slate for the seed tests — setup_db is session-scoped, so categories
    and detection_models from earlier tests would pollute the global queries
    reconcile_categories runs."""
    async with AsyncSessionLocal() as s:
        await s.execute(delete(Category))
        await s.execute(delete(DetectionModel))
        await s.commit()


async def _add_model(uuid: str, *, class_mapping=None, selected_label=None) -> None:
    async with AsyncSessionLocal() as s:
        s.add(
            DetectionModel(
                uuid=uuid,
                version="v1",
                filename=f"{uuid}.pt",
                uploaded_by="test",
                source="uploaded",
                class_mapping=json.dumps(class_mapping or []),
                selected_label=selected_label,
            )
        )
        await s.commit()


@pytest.mark.asyncio
async def test_resolves_detector_and_geometry_from_category(setup_db):
    await _add_model("det-1")
    async with AsyncSessionLocal() as s:
        await storage.create_category(
            s,
            "arandano",
            detection_model_uuid="det-1",
            method="tiled",
            count_mode="horizontal",
            threshold=0.4,
            direction="right2left",
            roi_mode="full",
            confidence=0.3,
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        cfg = await build_count_config(s, "arandano")

    assert cfg["model_uuid"] == "det-1"
    assert cfg["method"] == "tiled"
    assert cfg["count_mode"] == "horizontal"
    assert cfg["threshold"] == 0.4
    assert cfg["direction"] == "right2left"
    assert cfg["roi_mode"] == "full"
    assert cfg["confidence"] == 0.3
    assert cfg["target_class"] == "arandano"


@pytest.mark.asyncio
async def test_overrides_win_over_category_geometry(setup_db):
    await _add_model("det-2")
    async with AsyncSessionLocal() as s:
        await storage.create_category(
            s, "persona", detection_model_uuid="det-2", threshold=0.5
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        cfg = await build_count_config(
            s, "persona", overrides={"threshold": 0.9, "direction": "top2down"}
        )

    assert cfg["threshold"] == 0.9
    assert cfg["direction"] == "top2down"


@pytest.mark.asyncio
async def test_no_category_raises(setup_db):
    async with AsyncSessionLocal() as s:
        with pytest.raises(RuntimeError, match="no_category"):
            await build_count_config(s, "unknown-class")


@pytest.mark.asyncio
async def test_category_without_detector_raises(setup_db):
    async with AsyncSessionLocal() as s:
        await storage.create_category(s, "vacia")  # no detector assigned
        await s.commit()
    async with AsyncSessionLocal() as s:
        with pytest.raises(RuntimeError, match="no_category"):
            await build_count_config(s, "vacia")


@pytest.mark.asyncio
async def test_explicit_model_uuid_branch_still_works(setup_db):
    """The recount path pins a specific model regardless of category."""
    await _add_model("det-pinned")
    async with AsyncSessionLocal() as s:
        cfg = await build_count_config(
            s, "whatever", model_uuid="det-pinned", overrides={"threshold": 0.2}
        )
    assert cfg["model_uuid"] == "det-pinned"
    assert cfg["threshold"] == 0.2


@pytest.mark.asyncio
async def test_reconcile_seeds_from_active_model(setup_db):
    await _wipe_categories_and_models()
    await _add_model(
        "det-active",
        class_mapping=[
            {"model_label": "blueberry", "system_label": "arandano"},
            {"model_label": "person", "system_label": "persona"},
        ],
        selected_label="arandano",
    )

    await reconcile_categories()

    async with AsyncSessionLocal() as s:
        cats = {c.name: c for c in await storage.list_categories(s)}
    assert set(cats) == {"arandano", "persona"}
    assert cats["arandano"].detection_model_uuid == "det-active"
    assert cats["persona"].detection_model_uuid == "det-active"


@pytest.mark.asyncio
async def test_reconcile_is_idempotent_and_keeps_existing(setup_db):
    await _wipe_categories_and_models()
    await _add_model(
        "det-active2",
        class_mapping=[{"model_label": "blueberry", "system_label": "arandano"}],
        selected_label="arandano",
    )
    # A pre-existing (e.g. server-synced) category must not be overwritten.
    async with AsyncSessionLocal() as s:
        await storage.create_category(
            s, "arandano", detection_model_uuid="det-other", method="tiled"
        )
        await s.commit()

    await reconcile_categories()
    await reconcile_categories()

    async with AsyncSessionLocal() as s:
        cats = await storage.list_categories(s)
    assert len(cats) == 1
    assert cats[0].detection_model_uuid == "det-other"  # untouched
    assert cats[0].method == "tiled"
