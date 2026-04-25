"""Background sync loop — runs only in robot mode.

Periodically checks server connectivity and executes sync tasks:
push data, pull models (future), execute commands (future).
"""

import asyncio
import logging

import aiohttp

from back.config import config
from back.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def _check_server() -> bool:
    """Ping the server's health endpoint."""
    url = f"{config.sync.server_url}/api/sync/health"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    logger.info("Sync: server reachable at %s", config.sync.server_url)
                    return True
                logger.warning("Sync: server returned status %d", resp.status)
                return False
    except Exception as exc:
        logger.warning("Sync: server unreachable — %s", exc)
        return False


async def _sync_cycle() -> None:
    """Single sync cycle."""
    server_ok = await _check_server()
    if not server_ok:
        return

    from back.services.sync_pull import pull_models
    from back.services.sync_pull_context import pull_device_context
    from back.services.sync_push import push_all

    async with AsyncSessionLocal() as db:
        await push_all(db)

    await pull_models()
    await pull_device_context()

    # Future: execute commands (feature/sync-commands)
    logger.info("Sync: cycle complete")


async def start_sync_loop() -> None:
    """Run the sync loop forever at the configured interval."""
    interval = config.sync.interval_seconds
    logger.info(
        "Sync loop started — interval=%ds, server=%s",
        interval,
        config.sync.server_url,
    )
    while True:
        try:
            await _sync_cycle()
        except Exception:
            logger.exception("Sync: unexpected error in cycle")
        await asyncio.sleep(interval)
