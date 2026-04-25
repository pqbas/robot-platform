"""Robot-side blob upload for recordings.

Pushes the MP4 file for each Recording whose metadata has already been
synced (sync_log entry present) but ``uploaded_at`` is still null.

One recording at a time — large MP4s on a rural link should not run in
parallel and starve the metadata sync. Uses streaming (file handle, not
``read()``) so memory stays bounded.
"""

import logging
import os
from datetime import datetime, timezone

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.models import Recording, SyncLog

logger = logging.getLogger("sync_recordings_upload")


async def _is_metadata_synced(db: AsyncSession, uuid: str) -> bool:
    result = await db.execute(
        select(SyncLog).where(
            (SyncLog.table_name == "recordings") & (SyncLog.record_uuid == uuid)
        )
    )
    return result.scalar_one_or_none() is not None


async def _upload_one(http: aiohttp.ClientSession, row: Recording) -> bool:
    if not os.path.isfile(row.file_path):
        logger.warning(
            "Recording %s: local file %s missing — skip", row.uuid, row.file_path
        )
        return False

    url = f"{config.sync.server_url}/api/sync/recordings/{row.uuid}/upload"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    try:
        with open(row.file_path, "rb") as f:
            data = aiohttp.FormData()
            data.add_field(
                "file",
                f,
                filename=f"{row.uuid}.mp4",
                content_type="video/mp4",
            )
            async with http.post(url, data=data, headers=headers) as resp:
                if resp.status == 200:
                    logger.info(
                        "Recording %s uploaded (%d bytes)", row.uuid, row.file_size_bytes or 0
                    )
                    return True
                if resp.status == 409:
                    # Already uploaded server-side: treat as success.
                    logger.info("Recording %s: server reports already uploaded", row.uuid)
                    return True
                logger.warning(
                    "Recording %s: server returned %d", row.uuid, resp.status
                )
                return False
    except Exception as exc:
        logger.warning("Recording %s upload failed: %s", row.uuid, exc)
        return False


async def upload_pending_recordings(db: AsyncSession) -> None:
    if not config.sync.server_url:
        return

    result = await db.execute(
        select(Recording).where(
            Recording.uploaded_at.is_(None) & Recording.ended_at.is_not(None)
        ).order_by(Recording.started_at.asc())
    )
    rows = result.scalars().all()
    if not rows:
        return

    timeout = aiohttp.ClientTimeout(total=600, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as http:
        for row in rows:
            if not await _is_metadata_synced(db, row.uuid):
                # Wait for the metadata push (next cycle) before uploading.
                continue
            ok = await _upload_one(http, row)
            if ok:
                row.uploaded_at = datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
                await db.commit()
            else:
                # One failure short-circuits the rest of the queue: a
                # connectivity blip likely kills all of them, and the
                # next cycle retries from the top.
                break
