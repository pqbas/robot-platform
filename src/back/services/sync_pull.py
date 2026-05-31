"""Robot-side sync pull — downloads new/updated models from the server."""

import hashlib
import logging
from pathlib import Path

import aiohttp
from sqlalchemy import delete, select

from back.config import config
from back.database import AsyncSessionLocal
from back.models import DetectionModel
from back.services.perception.inference_client import InferenceClient
from back.services.perception.label_selection import derive_filtered_class_mapping

logger = logging.getLogger(__name__)


def _file_hash(path: Path) -> str:
    """Compute SHA256 hash of a local file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


async def _upsert_models(remote_models: list[dict]) -> None:
    """Upsert remote model metadata into local detection_models table."""
    remote_filenames = {m["filename"] for m in remote_models}

    async with AsyncSessionLocal() as session:
        # Remove models that are no longer assigned to this device
        result = await session.execute(select(DetectionModel))
        local_models = result.scalars().all()
        for local in local_models:
            if local.filename not in remote_filenames:
                await session.execute(
                    delete(DetectionModel).where(DetectionModel.filename == local.filename)
                )
                logger.info("Sync pull: removed deassigned model %s from local DB", local.filename)

        # Upsert each remote model
        for m in remote_models:
            result = await session.execute(
                select(DetectionModel).where(DetectionModel.filename == m["filename"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.file_hash = m["file_hash"]
                existing.source = m.get("source", "uploaded")
                existing.version = m["version"]
                existing.class_mapping = m.get("class_mapping")
                existing.notes = m.get("notes")
            else:
                session.add(DetectionModel(
                    uuid=m["uuid"],
                    filename=m["filename"],
                    file_hash=m["file_hash"],
                    source=m.get("source", "uploaded"),
                    version=m["version"],
                    class_mapping=m.get("class_mapping"),
                    notes=m.get("notes"),
                    uploaded_by="sync",
                    is_active=False,
                ))
        await session.commit()


async def pull_models() -> None:
    """Check server for assigned models, download any new or updated ones."""
    models_dir = Path(config.storage.models_dir)
    url = f"{config.sync.server_url}/api/sync/models"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            # 1. Get list of models assigned to this device
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning("Sync pull: failed to list models (status %d)", resp.status)
                    return
                remote_models = await resp.json()

            # 2. Upsert model metadata in local DB (including empty list — removes deassigned)
            await _upsert_models(remote_models)

            if not remote_models:
                logger.info("Sync pull: no models assigned to this device")
                return

            # 3. Download new/updated model files (skip library models — managed by ultralytics)
            # Build the assignment set as we go so step 4 can tell whether
            # the worker's currently-loaded model is still valid.
            assigned: list[tuple[str, str]] = []  # list of (path_for_worker, display_name)
            for model in remote_models:
                if model.get("source") == "library":
                    logger.info("Sync pull: %s is library model, skipping download", model["filename"])
                    assigned.append((model["filename"], model["filename"]))
                    continue

                local_path = models_dir / model["filename"]
                assigned.append((str(local_path.resolve()), model["filename"]))
                if local_path.exists():
                    local_hash = _file_hash(local_path)
                    if local_hash == model["file_hash"]:
                        logger.info("Sync pull: %s is up to date", model["filename"])
                        continue
                    logger.info("Sync pull: %s hash mismatch, downloading update", model["filename"])
                else:
                    logger.info("Sync pull: %s not found locally, downloading", model["filename"])

                download_url = f"{config.sync.server_url}/api/sync/models/{model['uuid']}"
                async with session.get(download_url, headers=headers) as dl_resp:
                    if dl_resp.status != 200:
                        logger.warning("Sync pull: failed to download %s (status %d)", model["filename"], dl_resp.status)
                        continue
                    content = await dl_resp.read()
                    local_path.write_bytes(content)
                    logger.info("Sync pull: downloaded %s (%d bytes)", model["filename"], len(content))

            # 4. Ensure worker is using one of the assigned models.
            # If the current model is already in the assigned set, leave it
            # alone — overriding would clobber the user's manual selection
            # (and its class filter). Only swap when nothing valid is loaded.
            if assigned:
                client = InferenceClient(config.perception.socket_path)
                status = client.send_command("status")
                current = status.get("model_path", "") if status else ""
                assigned_paths = {p for p, _ in assigned}
                # Also match by basename: select_label may have sent an
                # engine path while sync only knows the .pt filename.
                assigned_basenames = {Path(p).stem.split(".")[0] for p in assigned_paths}
                current_basename = Path(current).stem.split(".")[0] if current else ""
                if current in assigned_paths or current_basename in assigned_basenames:
                    logger.debug("Sync pull: worker already on assigned model %s", current)
                else:
                    # Prefer the model the user explicitly selected.
                    target = None
                    async with AsyncSessionLocal() as db:
                        for worker_path, display_name in assigned:
                            row = (await db.execute(
                                select(DetectionModel).where(
                                    DetectionModel.filename == display_name
                                )
                            )).scalar_one_or_none()
                            if row and row.selected_label:
                                target = (worker_path, display_name, row)
                                break
                        if target is None:
                            worker_path, display_name = assigned[0]
                            row = (await db.execute(
                                select(DetectionModel).where(
                                    DetectionModel.filename == display_name
                                )
                            )).scalar_one_or_none()
                            target = (worker_path, display_name, row)

                    worker_path, display_name, row = target
                    class_mapping: list = []
                    if row and row.selected_label:
                        class_mapping = derive_filtered_class_mapping(
                            row.class_mapping, row.selected_label
                        )
                    result = client.reload_model(worker_path, class_mapping=class_mapping)
                    if result and result.get("ok"):
                        logger.info("Sync pull: worker reloaded with %s", display_name)
                    else:
                        logger.warning("Sync pull: worker reload failed: %s", result)

    except Exception as exc:
        logger.warning("Sync pull failed: %s", exc)
