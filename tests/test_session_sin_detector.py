"""Sesión sin detector: la Vision page graba con un solo botón start/stop.

Si no hay detector configurado la sesión se guarda con ``target_class = NULL``
— es un video sin clase, contable después vía recount. Estos tests cubren el
marcador en memoria (qué habilita la inferencia en vivo) y la persistencia.
"""

import pytest
from sqlalchemy import select

from back.database import AsyncSessionLocal
from back.models import Session
from back.routes.counting import save_session
from back.schemas import SessionSave
from back.services.perception import counter


@pytest.fixture(autouse=True)
def _clean_counter():
    yield
    if counter.is_session_active():
        counter.stop_counting()
    counter.clear_last_recording_uuid()


def test_session_sin_detector_no_habilita_inferencia():
    counter.start_counting(None)
    assert counter.is_session_active() is True
    # La grabación corre, pero nadie somete frames al worker de inferencia.
    assert counter.is_detector_active() is False
    total, target = counter.stop_counting()
    assert (total, target) == (0, None)


def test_session_con_detector_habilita_inferencia():
    counter.start_counting("arandano")
    assert counter.is_detector_active() is True
    assert counter.get_active_session().target_class == "arandano"


@pytest.mark.asyncio
async def test_save_session_persiste_target_class_nulo(setup_db):
    async with AsyncSessionLocal() as db:
        sess = await save_session(
            SessionSave(camellon_id=None, target_class=None, total_count=0), db
        )
        await db.commit()
        saved_id = sess.id

    async with AsyncSessionLocal() as db:
        row = (
            await db.execute(select(Session).where(Session.id == saved_id))
        ).scalar_one()
        assert row.target_class is None
