"""Robot-side sync pull — downloads device context (empresa/fundo) from server."""

import json
import logging
from pathlib import Path

import aiohttp
from sqlalchemy import select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import Empresa, Fundo

logger = logging.getLogger(__name__)


async def _upsert_context(ctx: dict) -> None:
    """Mirror the empresa+fundo from the cached context into the local DB so
    camellones (which reference fundo_uuid) have a valid FK target locally.
    """
    empresa = ctx.get("empresa")
    fundo = ctx.get("fundo")
    if not empresa or not fundo:
        return
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Empresa).where(Empresa.uuid == empresa["uuid"])
        )
        existing_emp = result.scalar_one_or_none()
        if existing_emp:
            existing_emp.name = empresa["name"]
        else:
            session.add(Empresa(uuid=empresa["uuid"], name=empresa["name"]))

        result = await session.execute(
            select(Fundo).where(Fundo.uuid == fundo["uuid"])
        )
        existing_fundo = result.scalar_one_or_none()
        if existing_fundo:
            existing_fundo.name = fundo["name"]
            existing_fundo.region = fundo.get("region")
            existing_fundo.empresa_uuid = empresa["uuid"]
        else:
            session.add(Fundo(
                uuid=fundo["uuid"],
                empresa_uuid=empresa["uuid"],
                name=fundo["name"],
                region=fundo.get("region"),
            ))
        await session.commit()


async def pull_device_context() -> dict | None:
    """Fetch the device context from the server and cache it locally.

    Returns the context dict on success, None on failure (last cached
    value remains untouched on disk so the robot keeps the previous state).
    """
    url = f"{config.sync.server_url}/api/sync/device-context"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning(
                        "Sync pull context: server returned status %d", resp.status
                    )
                    return None
                ctx = await resp.json()
    except Exception as exc:
        logger.warning("Sync pull context failed: %s", exc)
        return None

    path = Path(config.storage.device_context_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ctx))

    try:
        await _upsert_context(ctx)
    except Exception as exc:
        logger.warning("Sync pull context: failed to upsert empresa/fundo: %s", exc)

    logger.info(
        "Sync pull context: cached fundo=%s empresa=%s",
        (ctx.get("fundo") or {}).get("name"),
        (ctx.get("empresa") or {}).get("name"),
    )
    return ctx


def read_cached_context() -> dict:
    """Read the locally cached device context. Returns empty context if missing."""
    path = Path(config.storage.device_context_path)
    if not path.exists():
        return {"empresa": None, "fundo": None}
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        logger.warning("Failed to read device context cache: %s", exc)
        return {"empresa": None, "fundo": None}
