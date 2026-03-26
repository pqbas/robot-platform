"""Empresa management routes — admin only."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.models import Empresa, Fundo
from back.services.auth import require_role

router = APIRouter(prefix="/api/empresas", tags=["empresas"])
admin_dep = require_role("admin")


class EmpresaCreate(BaseModel):
    name: str


class EmpresaUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class EmpresaOut(BaseModel):
    uuid: str
    name: str
    is_active: bool
    created_at: str | None

    model_config = {"from_attributes": True}


class FundoOut(BaseModel):
    uuid: str
    name: str
    region: str | None
    is_active: bool
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[EmpresaOut])
async def list_empresas(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Empresa))
    return result.scalars().all()


@router.post("/", response_model=EmpresaOut, status_code=201)
async def create_empresa(body: EmpresaCreate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    empresa = Empresa(name=body.name)
    db.add(empresa)
    await db.commit()
    await db.refresh(empresa)
    return empresa


@router.put("/{uuid}", response_model=EmpresaOut)
async def update_empresa(uuid: str, body: EmpresaUpdate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Empresa).where(Empresa.uuid == uuid))
    empresa = result.scalar_one_or_none()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa not found")
    if body.name is not None:
        empresa.name = body.name
    if body.is_active is not None:
        empresa.is_active = body.is_active
    await db.commit()
    await db.refresh(empresa)
    return empresa


@router.get("/{uuid}/fundos", response_model=list[FundoOut])
async def list_empresa_fundos(uuid: str, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(Fundo).where(Fundo.empresa_uuid == uuid))
    return result.scalars().all()
