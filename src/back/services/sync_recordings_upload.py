"""Robot-side blob upload for recordings.

Pushes the MP4 file for each Recording whose metadata has already been
synced (sync_log entry present) but ``uploaded_at`` is still null.

Separately, pushes the ``{uuid}.jsonl`` detection sidecar, tracked by its own
``detections_uploaded_at`` column. The sidecar is decoupled from the MP4 flag
on purpose: the counting-worker writes it incrementally AFTER recording ends,
so it is only safe to upload when the count is NOT in progress
(``count_status`` not in counting/pending) — a mid-count sidecar is partial and
would freeze the server replay. The poller clears ``detections_uploaded_at``
whenever a (re)count finishes, so the complete sidecar (re)uploads on the next
cycle — this also repairs a server copy left truncated by the old mid-count
race and propagates re-counts. Static none/error sidecars (e.g. old
live-counted sessions) are covered too.

One recording at a time — large MP4s on a rural link should not run in
parallel and starve the metadata sync. Uses streaming (file handle, not
``read()``) so memory stays bounded.
"""

import logging
import os
from datetime import datetime, timezone

import aiohttp
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.models import Recording, SyncLog
from back.services.perception.classification_trigger import (
    classifications_path_for,
    crops_dir_for,
    crossings_path_for,
)

logger = logging.getLogger("sync_recordings_upload")

_uploading_uuids: set[str] = set()


def get_uploading_uuids() -> list[str]:
    return list(_uploading_uuids)


async def _is_metadata_synced(db: AsyncSession, uuid: str) -> bool:
    result = await db.execute(
        select(SyncLog).where(
            (SyncLog.table_name == "recordings") & (SyncLog.record_uuid == uuid)
        )
    )
    return result.scalar_one_or_none() is not None


async def _probe_lan(http: aiohttp.ClientSession, lan_url: str) -> bool:
    try:
        async with http.get(f"{lan_url}/api/sync/health", timeout=aiohttp.ClientTimeout(total=2)) as resp:
            return resp.status == 200
    except Exception:
        return False


async def _upload_one(http: aiohttp.ClientSession, row: Recording, base_url: str) -> bool:
    if not os.path.isfile(row.file_path):
        logger.warning(
            "Recording %s: local file %s missing — skip", row.uuid, row.file_path
        )
        return False

    url = f"{base_url}/api/sync/recordings/{row.uuid}/upload"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    _uploading_uuids.add(row.uuid)
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
    finally:
        _uploading_uuids.discard(row.uuid)


async def _upload_detections(http: aiohttp.ClientSession, row: Recording, base_url: str) -> bool:
    """Upload the {uuid}.jsonl detection log next to the MP4. Returns success.

    A failure is logged but never blocks the MP4 (the primary artifact); the
    caller leaves ``detections_uploaded_at`` NULL so the next cycle retries.
    """
    det_path = os.path.join(os.path.dirname(row.file_path), f"{row.uuid}.jsonl")
    if not os.path.isfile(det_path):
        return False

    url = f"{base_url}/api/sync/recordings/{row.uuid}/detections/upload"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}
    try:
        with open(det_path, "rb") as f:
            data = aiohttp.FormData()
            data.add_field(
                "file",
                f,
                filename=f"{row.uuid}.jsonl",
                content_type="application/x-ndjson",
            )
            async with http.post(url, data=data, headers=headers) as resp:
                if resp.status == 200:
                    logger.info("Detection log %s uploaded", row.uuid)
                    return True
                logger.warning(
                    "Detection log %s: server returned %d", row.uuid, resp.status
                )
                return False
    except Exception as exc:
        logger.warning("Detection log %s upload failed: %s", row.uuid, exc)
        return False


# While the count is in these states the counting-worker is actively (re)writing
# the JSONL, so a snapshot would be partial — uploading it freezes the server
# replay at the last logged frame. Every other state (none/done/error) has a
# static sidecar that is safe to push as-is.
_COUNTING_IN_PROGRESS = ("counting", "pending")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sidecar_needs_upload(count_status: str, detections_uploaded_at: str | None) -> bool:
    """Whether a recording's detection sidecar should be (re)pushed now.

    Safe ⇔ ``count_status`` is NOT one of ``_COUNTING_IN_PROGRESS`` — i.e. the
    JSONL is not being written right now (a mid-count file is partial). This
    deliberately includes ``none``/``error`` recordings: their sidecar (e.g. an
    old live-counted session) is static and complete locally, and the server's
    copy may have been truncated by the old mid-count upload race. Dirty ⇔
    ``detections_uploaded_at is None`` (cleared by the poller on every (re)count,
    or born NULL after the migration). Decoupled from the MP4's ``uploaded_at``
    so re-counts and earlier truncations get repaired even after the MP4 landed.
    """
    return count_status not in _COUNTING_IN_PROGRESS and detections_uploaded_at is None


async def _push_sidecar_if_ready(
    db: AsyncSession, http: aiohttp.ClientSession, row: Recording, base_url: str
) -> None:
    """(Re)push the detection sidecar when it is static (not mid-count) and dirty."""
    if not _sidecar_needs_upload(row.count_status, row.detections_uploaded_at):
        return
    det_path = os.path.join(os.path.dirname(row.file_path), f"{row.uuid}.jsonl")
    if not os.path.isfile(det_path):
        # Uncounted recording with no sidecar to push: mark reconciled so the
        # loop stops re-scanning it. A later (re)count clears this again via the
        # poller, so a future sidecar still gets pushed.
        row.detections_uploaded_at = _utcnow_iso()
        await db.commit()
        return
    if await _upload_detections(http, row, base_url):
        row.detections_uploaded_at = _utcnow_iso()
        await db.commit()


# Ripeness classification artifacts — mirror of the detection sidecar flow, but
# split across two dirty flags: ``classifications_uploaded_at`` (the jsonl the
# server transcribes into fruit_crops/fruit_classifications) and
# ``crops_uploaded_at`` (the heavy JPGs). Both require the MP4 to have landed
# first, because the server derives the sidecar/crops paths from the recording's
# server-side ``file_path`` (only rewritten on MP4 upload).
_CLASSIFYING_IN_PROGRESS = ("pending", "classifying")


def _classifications_need_upload(
    classification_status: str,
    classifications_uploaded_at: str | None,
    uploaded_at: str | None,
) -> bool:
    """Whether a recording's classification jsonl should be (re)pushed now.

    Requires ``uploaded_at`` set (server path resolved via the MP4 upload),
    a static classify (``classification_status`` ∉ pending/classifying — a
    mid-classify jsonl is partial) and a dirty flag
    (``classifications_uploaded_at is None``). Includes ``none``/``error`` rows:
    their (absent) sidecar is reconciled once so the loop stops re-scanning them.
    """
    return (
        uploaded_at is not None
        and classification_status not in _CLASSIFYING_IN_PROGRESS
        and classifications_uploaded_at is None
    )


async def _upload_classification_sidecars(
    http: aiohttp.ClientSession, row: Recording, base_url: str
) -> bool:
    """Push ``{uuid}.classifications.jsonl`` (+ ``{uuid}.crossings.jsonl`` for
    completeness). Returns success of the classifications file — the one the
    server transcribes; crossings is best-effort and never gates the flag."""
    cls_path = classifications_path_for(row)
    if not os.path.isfile(cls_path):
        return False
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    ok = False
    try:
        with open(cls_path, "rb") as f:
            data = aiohttp.FormData()
            data.add_field(
                "file",
                f,
                filename=f"{row.uuid}.classifications.jsonl",
                content_type="application/x-ndjson",
            )
            url = f"{base_url}/api/sync/recordings/{row.uuid}/classifications/upload"
            async with http.post(url, data=data, headers=headers) as resp:
                ok = resp.status == 200
                if ok:
                    logger.info("Classifications %s uploaded", row.uuid)
                else:
                    logger.warning(
                        "Classifications %s: server returned %d", row.uuid, resp.status
                    )
    except Exception as exc:
        logger.warning("Classifications %s upload failed: %s", row.uuid, exc)
        return False

    # crossings.jsonl is not needed for the server's ripeness view; push it for
    # future re-classification but never let its failure block the flag.
    crossings = crossings_path_for(row)
    if os.path.isfile(crossings):
        try:
            with open(crossings, "rb") as f:
                data = aiohttp.FormData()
                data.add_field(
                    "file",
                    f,
                    filename=f"{row.uuid}.crossings.jsonl",
                    content_type="application/x-ndjson",
                )
                url = f"{base_url}/api/sync/recordings/{row.uuid}/crossings/upload"
                async with http.post(url, data=data, headers=headers) as resp:
                    if resp.status != 200:
                        logger.warning(
                            "Crossings %s: server returned %d", row.uuid, resp.status
                        )
        except Exception as exc:
            logger.warning("Crossings %s upload failed: %s", row.uuid, exc)

    return ok


async def _upload_crops(
    http: aiohttp.ClientSession, row: Recording, base_url: str
) -> bool:
    """Push every crop JPG under ``crops_dir_for(row)``, one at a time. Returns
    True only if all present crops uploaded (a partial failure keeps the dirty
    flag so the next cycle retries). No crops dir ⇒ nothing to do ⇒ True."""
    crops_dir = crops_dir_for(row)
    if not os.path.isdir(crops_dir):
        return True
    names = sorted(n for n in os.listdir(crops_dir) if n.lower().endswith(".jpg"))
    if not names:
        return True
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}
    for name in names:
        path = os.path.join(crops_dir, name)
        try:
            with open(path, "rb") as f:
                data = aiohttp.FormData()
                data.add_field("file", f, filename=name, content_type="image/jpeg")
                url = f"{base_url}/api/sync/recordings/{row.uuid}/crops/upload"
                async with http.post(url, data=data, headers=headers) as resp:
                    if resp.status != 200:
                        logger.warning(
                            "Crop %s/%s: server returned %d", row.uuid, name, resp.status
                        )
                        return False
        except Exception as exc:
            logger.warning("Crop %s/%s upload failed: %s", row.uuid, name, exc)
            return False
    logger.info("Crops %s uploaded (%d files)", row.uuid, len(names))
    return True


async def _push_classifications_if_ready(
    db: AsyncSession, http: aiohttp.ClientSession, row: Recording, base_url: str
) -> None:
    """(Re)push the classification jsonl and crop JPGs when static, dirty and the
    MP4 has already landed. The two flags are handled independently so a crop
    failure retries without re-sending the (already-landed) jsonl."""
    if row.uploaded_at is None or row.classification_status in _CLASSIFYING_IN_PROGRESS:
        return

    # 1. classifications jsonl (+ crossings) → server transcribes to fruit_* rows.
    if row.classifications_uploaded_at is None:
        if not os.path.isfile(classifications_path_for(row)):
            # No sidecar (e.g. category has no classifier → status 'none'): mark
            # reconciled so the loop stops re-scanning. A future (re)classify
            # clears this again via the poller.
            row.classifications_uploaded_at = _utcnow_iso()
            await db.commit()
        elif await _upload_classification_sidecars(http, row, base_url):
            row.classifications_uploaded_at = _utcnow_iso()
            await db.commit()

    # 2. crop JPGs (heavy) — own flag so a partial failure retries without
    #    re-sending the jsonl.
    if row.crops_uploaded_at is None:
        if await _upload_crops(http, row, base_url):
            row.crops_uploaded_at = _utcnow_iso()
            await db.commit()


async def upload_single_recording(db: AsyncSession, uuid: str) -> str:
    """Push one recording's MP4 (+ detections) over the LAN, on demand.

    Mirrors :func:`upload_pending_recordings` but targets a single uuid and
    returns a status string instead of silently breaking the queue, so a
    manual trigger (per-session button) can report back to the UI:

    - ``"uploaded"`` — MP4 sent and ``uploaded_at`` set this call.
    - ``"already"``  — server already had it (``uploaded_at`` already set).
    - ``"pending"``  — could not upload now (sync disabled, metadata not yet
      pushed, LAN unreachable, or transfer failed); the loop will retry later.
    - ``"missing"``  — local MP4 file is gone; nothing to upload.
    - ``"none"``     — recording not found or still in progress.
    """
    if not config.sync.server_url or not config.sync.lan_url:
        return "pending"

    result = await db.execute(select(Recording).where(Recording.uuid == uuid))
    row = result.scalar_one_or_none()
    if row is None or row.ended_at is None:
        return "none"
    if not os.path.isfile(row.file_path):
        return "missing"
    if not await _is_metadata_synced(db, uuid):
        # Metadata must land first (server resolves FKs from it).
        return "pending"

    timeout = aiohttp.ClientTimeout(total=600, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as http:
        if not await _probe_lan(http, config.sync.lan_url):
            logger.warning("LAN no alcanzable (%s) — upload omitido", config.sync.lan_url)
            return "pending"
        if row.uploaded_at is None:
            if not await _upload_one(http, row, config.sync.lan_url):
                return "pending"
            row.uploaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            await db.commit()
            status = "uploaded"
        else:
            status = "already"
        # Always (re)push the sidecar when its count is done and dirty — this is
        # what repairs a server copy truncated by an earlier mid-count upload and
        # propagates re-counts, even when the MP4 landed long ago. Pressing the
        # session/recording sync button thus also re-syncs the detection log.
        await _push_sidecar_if_ready(db, http, row, config.sync.lan_url)
        # Same for the ripeness classification (jsonl + crops) — one manual click
        # carries the full session: MP4 + detections + classification.
        await _push_classifications_if_ready(db, http, row, config.sync.lan_url)
        return status


async def upload_pending_recordings(db: AsyncSession) -> None:
    if not config.sync.server_url:
        return

    if not config.sync.lan_url:
        return

    mp4_rows = (
        await db.execute(
            select(Recording).where(
                Recording.uploaded_at.is_(None) & Recording.ended_at.is_not(None)
            ).order_by(Recording.started_at.asc())
        )
    ).scalars().all()

    # Sidecars that are static (not being written right now) but haven't been
    # pushed yet — the count finished after the MP4 was already uploaded, a
    # re-count re-wrote it, or (after this migration) it predates sidecar
    # tracking and needs a one-time (re)push to repair an earlier truncated
    # server copy. Includes none/error recordings (old live-counted sessions).
    sidecar_rows = (
        await db.execute(
            select(Recording).where(
                Recording.count_status.notin_(_COUNTING_IN_PROGRESS)
                & (Recording.detections_uploaded_at.is_(None))
                & Recording.ended_at.is_not(None)
            ).order_by(Recording.started_at.asc())
        )
    ).scalars().all()

    # Classification artifacts (jsonl + crops) that are static and dirty, with the
    # MP4 already landed. Either flag dirty pulls the row in — the crops flag can
    # outlive the jsonl one when a crop upload failed on an earlier cycle.
    classification_rows = (
        await db.execute(
            select(Recording).where(
                Recording.classification_status.notin_(_CLASSIFYING_IN_PROGRESS)
                & Recording.uploaded_at.is_not(None)
                & Recording.ended_at.is_not(None)
                & or_(
                    Recording.classifications_uploaded_at.is_(None),
                    Recording.crops_uploaded_at.is_(None),
                )
            ).order_by(Recording.started_at.asc())
        )
    ).scalars().all()

    if not mp4_rows and not sidecar_rows and not classification_rows:
        return

    timeout = aiohttp.ClientTimeout(total=600, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as http:
        if not await _probe_lan(http, config.sync.lan_url):
            logger.warning("LAN no alcanzable (%s) — upload omitido", config.sync.lan_url)
            return
        for row in mp4_rows:
            if not await _is_metadata_synced(db, row.uuid):
                # Wait for the metadata push (next cycle) before uploading.
                continue
            ok = await _upload_one(http, row, config.sync.lan_url)
            if ok:
                row.uploaded_at = datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
                await db.commit()
                # If its sidecar is static (not mid-count), push it now too.
                await _push_sidecar_if_ready(db, http, row, config.sync.lan_url)
                # And its classification (jsonl + crops), now that the MP4 landed.
                await _push_classifications_if_ready(db, http, row, config.sync.lan_url)
            else:
                # One failure short-circuits the rest of the queue: a
                # connectivity blip likely kills all of them, and the
                # next cycle retries from the top.
                break
        for row in sidecar_rows:
            # May have been pushed already in the MP4 loop above (same session →
            # same object), so re-check the dirty flag before re-sending.
            if row.detections_uploaded_at is not None:
                continue
            if not await _is_metadata_synced(db, row.uuid):
                continue
            await _push_sidecar_if_ready(db, http, row, config.sync.lan_url)
        for row in classification_rows:
            # May have been pushed in the MP4 loop above (same object); the
            # helper re-checks both dirty flags, so a redundant call is a no-op.
            if not await _is_metadata_synced(db, row.uuid):
                continue
            await _push_classifications_if_ready(db, http, row, config.sync.lan_url)
