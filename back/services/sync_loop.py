"""Background sync loop — runs only in robot mode.

Periodically checks server connectivity and will execute sync tasks
(push data, pull models, execute commands) in future branches.
"""

import asyncio
import logging

import aiohttp

from back.config import config

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
    """Single sync cycle. Will be extended in future branches."""
    server_ok = await _check_server()
    if not server_ok:
        return

    # Future: push data (feature/sync-push)
    # Future: pull models (feature/sync-pull)
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
