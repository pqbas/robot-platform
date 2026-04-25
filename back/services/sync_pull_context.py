"""Robot-side sync pull — downloads device context (empresa/fundo) from server."""

import json
import logging
from pathlib import Path

import aiohttp

from back.config import config

logger = logging.getLogger(__name__)


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
