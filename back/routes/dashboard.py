from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.schemas import DashboardStatsOut
from back.services import storage

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStatsOut)
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    target_class: str | None = Query(None),
    camellon_id: int | None = Query(None),
):
    return await storage.get_dashboard_stats(
        db,
        date_from=date_from,
        date_to=date_to,
        target_class=target_class,
        camellon_id=camellon_id,
    )
