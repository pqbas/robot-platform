"""Sync endpoints — shared between robot and server modes."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.schemas import (
    SyncCamellon,
    SyncEmpresa,
    SyncEvent,
    SyncFruitType,
    SyncFundo,
    SyncLocation,
    SyncResult,
    SyncSession,
)
from back.services.sync_receive import (
    receive_camellones,
    receive_empresas,
    receive_events,
    receive_fruit_types,
    receive_fundos,
    receive_locations,
    receive_sessions,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.get("/health")
async def health():
    """Health check for sync connectivity."""
    return {"status": "ok", "mode": config.mode.value}


# --- Receive endpoints (server mode) ---


@router.post("/empresas", response_model=SyncResult)
async def sync_empresas(items: list[SyncEmpresa], db: AsyncSession = Depends(get_db)):
    return await receive_empresas(db, items)


@router.post("/fruit-types", response_model=SyncResult)
async def sync_fruit_types(items: list[SyncFruitType], db: AsyncSession = Depends(get_db)):
    return await receive_fruit_types(db, items)


@router.post("/fundos", response_model=SyncResult)
async def sync_fundos(items: list[SyncFundo], db: AsyncSession = Depends(get_db)):
    return await receive_fundos(db, items)


@router.post("/locations", response_model=SyncResult)
async def sync_locations(items: list[SyncLocation], db: AsyncSession = Depends(get_db)):
    return await receive_locations(db, items)


@router.post("/camellones", response_model=SyncResult)
async def sync_camellones(items: list[SyncCamellon], db: AsyncSession = Depends(get_db)):
    return await receive_camellones(db, items)


@router.post("/sessions", response_model=SyncResult)
async def sync_sessions(items: list[SyncSession], db: AsyncSession = Depends(get_db)):
    return await receive_sessions(db, items)


@router.post("/events", response_model=SyncResult)
async def sync_events(items: list[SyncEvent], db: AsyncSession = Depends(get_db)):
    return await receive_events(db, items)
