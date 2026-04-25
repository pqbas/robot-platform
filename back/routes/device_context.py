"""Robot-side endpoint exposing the cached device context to the frontend."""

from fastapi import APIRouter, HTTPException

from back.config import AppMode, config
from back.services.sync_pull_context import read_cached_context

router = APIRouter(prefix="/api/device-context", tags=["device-context"])


@router.get("/")
async def get_device_context():
    """Return the empresa+fundo cached locally on the robot.

    Returns the last successfully synced value. If no sync has happened yet
    or the cache is missing, returns nulls — the UI shows "Sin fundo asignado".
    """
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=404)
    return read_cached_context()
