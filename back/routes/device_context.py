"""Robot-side endpoints for device context (empresa/fundo) selection."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from back.config import AppMode, config
from back.database import AsyncSessionLocal
from back.models import Empresa, Fundo
from back.schemas import ActiveContextSet
from back.services.sync_pull_context import (
    read_effective_context,
    write_active_context,
    _upsert_empresa_fundo,
)

router = APIRouter(prefix="/api/device-context", tags=["device-context"])


@router.get("/")
async def get_device_context():
    """Return the effective empresa+fundo context on the robot.

    Returns the sticky active context if set by the operator, otherwise
    falls back to the last synced device context. If neither is set,
    returns nulls — the UI shows "Sin fundo asignado".
    """
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=404)
    return read_effective_context()


@router.post("/active")
async def set_active_context(body: ActiveContextSet):
    """Set the operator's sticky active context (robot mode only).

    Accepts empresa and fundo identified by UUID + name. The empresa/fundo
    are upserted locally so camellones have a valid FK target even offline.
    The written context takes precedence over the synced device context
    until overwritten again.
    """
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=404)

    empresa_dict = {"uuid": body.empresa_uuid, "name": body.empresa_name}
    fundo_dict = {
        "uuid": body.fundo_uuid,
        "name": body.fundo_name,
        "region": body.fundo_region,
    }

    ctx = {
        "empresa": empresa_dict,
        "fundo": fundo_dict,
    }
    write_active_context(ctx)

    try:
        async with AsyncSessionLocal() as session:
            await _upsert_empresa_fundo(session, empresa_dict, fundo_dict)
            await session.commit()
    except Exception:
        pass  # DB upsert is best-effort; context file is already written

    return read_effective_context()
