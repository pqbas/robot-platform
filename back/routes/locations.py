from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.schemas import LocationCreate, LocationOut, LocationUpdate
from back.services import storage

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationOut])
async def list_locations(db: AsyncSession = Depends(get_db)):
    return await storage.list_locations(db)


@router.post("", response_model=LocationOut, status_code=201)
async def create_location(body: LocationCreate, db: AsyncSession = Depends(get_db)):
    polygon_dicts = [p.model_dump() for p in body.polygon] if body.polygon else None
    return await storage.create_location(
        db, body.label, body.lat, body.lng, body.zoom, polygon=polygon_dicts
    )


@router.put("/{location_id}/polygon", response_model=LocationOut)
async def update_polygon(
    location_id: int, body: LocationUpdate, db: AsyncSession = Depends(get_db)
):
    polygon_dicts = [p.model_dump() for p in body.polygon] if body.polygon else None
    loc = await storage.update_location_polygon(db, location_id, polygon_dicts)
    if loc is None:
        raise HTTPException(404, "Location not found")
    return loc


@router.delete("/{location_id}", status_code=204)
async def delete_location(location_id: int, db: AsyncSession = Depends(get_db)):
    deleted = await storage.delete_location(db, location_id)
    if not deleted:
        raise HTTPException(404, "Location not found")
