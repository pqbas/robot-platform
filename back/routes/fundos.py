"""Fundo management routes.

Server mode: admin-only (require_role("admin")).
Robot mode: list + create without auth gate (operator can create on-field).
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import Fundo, SyncLog
from back.services.auth import require_role

router = APIRouter(prefix="/api/fundos", tags=["fundos"])

# In server mode all routes require admin; in robot mode the dep list is empty.
_admin_dep = [Depends(require_role("admin"))] if config.mode == AppMode.SERVER else []


class FundoCreate(BaseModel):
    empresa_uuid: str
    name: str
    region: str | None = None


class FundoUpdate(BaseModel):
    name: str | None = None
    region: str | None = None
    is_active: bool | None = None


class FundoOut(BaseModel):
    uuid: str
    empresa_uuid: str
    name: str
    region: str | None
    is_active: bool
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[FundoOut], dependencies=_admin_dep)
async def list_fundos(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Fundo))
    return result.scalars().all()


@router.post("/", response_model=FundoOut, status_code=201, dependencies=_admin_dep)
async def create_fundo(body: FundoCreate, db: AsyncSession = Depends(get_db)):
    fundo = Fundo(
        empresa_uuid=body.empresa_uuid,
        name=body.name,
        region=body.region,
    )
    db.add(fundo)
    await db.commit()
    await db.refresh(fundo)
    return fundo


@router.put("/{uuid}", response_model=FundoOut, dependencies=_admin_dep)
async def update_fundo(uuid: str, body: FundoUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Fundo).where(Fundo.uuid == uuid))
    fundo = result.scalar_one_or_none()
    if not fundo:
        raise HTTPException(status_code=404, detail="Fundo not found")
    if body.name is not None:
        fundo.name = body.name
    if body.region is not None:
        fundo.region = body.region
    if body.is_active is not None:
        fundo.is_active = body.is_active
    await db.execute(delete(SyncLog).where(
        (SyncLog.table_name == "fundos") & (SyncLog.record_uuid == uuid)
    ))
    await db.commit()
    await db.refresh(fundo)
    return fundo
