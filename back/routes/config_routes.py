from fastapi import APIRouter

from back.config import config
from back.schemas import CountingConfigOut, CountingConfigUpdate

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/counting", response_model=CountingConfigOut)
async def get_counting_config():
    c = config.counting
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
    )


@router.put("/counting", response_model=CountingConfigOut)
async def update_counting_config(body: CountingConfigUpdate):
    c = config.counting
    if body.count_mode is not None:
        c.count_mode = body.count_mode
    if body.threshold is not None:
        c.threshold = body.threshold
    if body.direction is not None:
        c.direction = body.direction
    if body.confidence_threshold is not None:
        c.confidence_threshold = body.confidence_threshold
    return CountingConfigOut(
        count_mode=c.count_mode,
        threshold=c.threshold,
        direction=c.direction,
        confidence_threshold=c.confidence_threshold,
    )
