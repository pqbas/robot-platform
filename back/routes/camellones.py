import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.schemas import (
    CamellonCreate,
    CamellonGeoSummary,
    CamellonLocationUpdate,
    CamellonOut,
    CamellonRename,
    CamellonSummary,
)
from back.services import storage
from back.services.sync_pull_context import read_effective_context

logger = logging.getLogger("camellones")

router = APIRouter(prefix="/api/camellones", tags=["camellones"])


def _fundo_scope() -> tuple[bool, str | None]:
    """On the robot, camellones are scoped to the effective fundo context so
    operators never see/save into another organization's beds. On the server
    (multi-tenant, role-gated elsewhere) the list stays unscoped.

    Returns (scope_fundo, fundo_uuid) for the storage helpers.
    """
    if config.mode != AppMode.ROBOT:
        return False, None
    ctx = read_effective_context()
    fundo = ctx.get("fundo") or {}
    fundo_uuid = fundo.get("uuid") if isinstance(fundo, dict) else None
    return True, fundo_uuid


@router.get("", response_model=list[CamellonOut])
async def list_camellones(
    fundo_uuid: Optional[str] = Query(default=None),
    all_fundos: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    if all_fundos:
        # Unscoped: every camellon this device knows about. Used by cross-fundo
        # views like the sessions history, where the robot legitimately shows
        # every session it captured regardless of the currently selected fundo.
        return await storage.list_camellones(db)
    if fundo_uuid is not None:
        # Explicit fundo_uuid param overrides context scoping
        return await storage.list_camellones(db, scope_fundo=True, fundo_uuid=fundo_uuid)
    scope_fundo, ctx_fundo_uuid = _fundo_scope()
    return await storage.list_camellones(
        db, scope_fundo=scope_fundo, fundo_uuid=ctx_fundo_uuid
    )


@router.post("", response_model=CamellonOut, status_code=201)
async def create_camellon(body: CamellonCreate, db: AsyncSession = Depends(get_db)):
    # Determine the effective fundo_uuid for this creation:
    # 1. Use explicitly provided fundo_uuid if given
    # 2. Fall back to the effective context fundo
    if body.fundo_uuid is not None:
        fundo_uuid = body.fundo_uuid
    else:
        _, fundo_uuid = _fundo_scope()

    existing = await storage.get_camellon_by_nombre(
        db, body.nombre, scope_fundo=True, fundo_uuid=fundo_uuid
    )
    if existing is not None:
        raise HTTPException(409, f"Camellon '{body.nombre}' already exists")
    return await storage.create_camellon(db, body.nombre, fundo_uuid)


@router.patch("/{camellon_id}", response_model=CamellonOut)
async def rename_camellon(
    camellon_id: int, body: CamellonRename, db: AsyncSession = Depends(get_db)
):
    cam = await storage.get_camellon(db, camellon_id)
    if cam is None:
        raise HTTPException(404, "Camellon not found")
    # Scope uniqueness check to the row's own fundo_uuid, not the context.
    # This prevents collision checks bleeding across fundos.
    existing = await storage.get_camellon_by_nombre(
        db, body.nombre, scope_fundo=True, fundo_uuid=cam.fundo_uuid
    )
    if existing is not None and existing.id != camellon_id:
        raise HTTPException(409, f"Camellon '{body.nombre}' already exists")
    cam.nombre = body.nombre
    await db.commit()
    await db.refresh(cam)
    return cam


@router.put("/{camellon_id}/location", response_model=CamellonOut)
async def update_location(
    camellon_id: int,
    body: CamellonLocationUpdate,
    db: AsyncSession = Depends(get_db),
):
    cam = await storage.update_camellon_location(db, camellon_id, body.lat, body.lng)
    if cam is None:
        raise HTTPException(404, "Camellon not found")
    return cam


@router.get("/summary", response_model=list[CamellonSummary])
async def camellon_summary(db: AsyncSession = Depends(get_db)):
    return await storage.get_camellon_summary(db)


@router.get("/geo-summary", response_model=list[CamellonGeoSummary])
async def camellon_geo_summary(db: AsyncSession = Depends(get_db)):
    return await storage.get_camellon_geo_summary(db)
