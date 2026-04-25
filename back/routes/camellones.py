import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.schemas import (
    CamellonCreate,
    CamellonGeoSummary,
    CamellonLocationUpdate,
    CamellonOut,
    CamellonSummary,
)
from back.services import storage
from back.services.sync_pull_context import read_cached_context

logger = logging.getLogger("camellones")

router = APIRouter(prefix="/api/camellones", tags=["camellones"])


@router.get("", response_model=list[CamellonOut])
async def list_camellones(db: AsyncSession = Depends(get_db)):
    return await storage.list_camellones(db)


@router.post("", response_model=CamellonOut, status_code=201)
async def create_camellon(body: CamellonCreate, db: AsyncSession = Depends(get_db)):
    existing = await storage.get_camellon_by_nombre(db, body.nombre)
    if existing is not None:
        raise HTTPException(409, f"Camellon '{body.nombre}' already exists")
    fundo_uuid: str | None = None
    if config.mode == AppMode.ROBOT:
        ctx = read_cached_context()
        fundo = ctx.get("fundo") or {}
        fundo_uuid = fundo.get("uuid") if isinstance(fundo, dict) else None
    return await storage.create_camellon(db, body.nombre, fundo_uuid)


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
