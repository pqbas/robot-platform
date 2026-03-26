"""Robot-side sync pull — downloads new/updated models from the server."""

import hashlib
import logging
from pathlib import Path

import aiohttp

from back.config import config

logger = logging.getLogger(__name__)


def _file_hash(path: Path) -> str:
    """Compute SHA256 hash of a local file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


async def pull_models() -> None:
    """Check server for active models, download any new or updated ones."""
    models_dir = Path(config.storage.models_dir)
    url = f"{config.sync.server_url}/api/sync/models"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            # 1. Get list of active models
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning("Sync pull: failed to list models (status %d)", resp.status)
                    return
                remote_models = await resp.json()

            if not remote_models:
                logger.info("Sync pull: no active models on server")
                return

            # 2. Compare with local files
            for model in remote_models:
                local_path = models_dir / model["filename"]
                if local_path.exists():
                    local_hash = _file_hash(local_path)
                    if local_hash == model["file_hash"]:
                        logger.info("Sync pull: %s is up to date", model["filename"])
                        continue
                    logger.info("Sync pull: %s hash mismatch, downloading update", model["filename"])
                else:
                    logger.info("Sync pull: %s not found locally, downloading", model["filename"])

                # 3. Download model
                download_url = f"{config.sync.server_url}/api/sync/models/{model['uuid']}"
                async with session.get(download_url, headers=headers) as dl_resp:
                    if dl_resp.status != 200:
                        logger.warning("Sync pull: failed to download %s (status %d)", model["filename"], dl_resp.status)
                        continue
                    content = await dl_resp.read()
                    local_path.write_bytes(content)
                    logger.info("Sync pull: downloaded %s (%d bytes)", model["filename"], len(content))

    except Exception as exc:
        logger.warning("Sync pull failed: %s", exc)
