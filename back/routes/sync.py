"""Sync endpoints — shared between robot and server modes."""

from fastapi import APIRouter

from back.config import config

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.get("/health")
async def health():
    """Health check for sync connectivity."""
    return {"status": "ok", "mode": config.mode.value}
