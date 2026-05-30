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


async def _upsert_empresa_fundo(session, empresa: dict, fundo: dict) -> None:
    """Mirror one empresa+fundo pair into the local DB so camellones
    (which reference fundo_uuid) have a valid FK target locally.
    """
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


async def _upsert_context(ctx: dict) -> None:
    """Mirror the empresa+fundo from the cached context into the local DB so
    camellones (which reference fundo_uuid) have a valid FK target locally.
    """
    empresa = ctx.get("empresa")
    fundo = ctx.get("fundo")
    if not empresa or not fundo:
        return
    async with AsyncSessionLocal() as session:
        await _upsert_empresa_fundo(session, empresa, fundo)
        await session.commit()


# ---------------------------------------------------------------------------
# Active context (sticky selection by operator)
# ---------------------------------------------------------------------------

def read_active_context() -> dict | None:
    """Read the operator's sticky active context. Returns None if not set."""
    path = Path(config.storage.active_context_path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        # Validate minimal structure
        if isinstance(data, dict) and "empresa" in data and "fundo" in data:
            return data
        return None
    except Exception as exc:
        logger.warning("Failed to read active context: %s", exc)
        return None


def write_active_context(ctx: dict) -> None:
    """Write the operator's sticky active context to disk."""
    path = Path(config.storage.active_context_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ctx))


def read_effective_context() -> dict:
    """Return the effective context: active (sticky) if set, else synced.

    This is the single source of truth for the rest of the app.
    Active context takes precedence over the synced device context so that
    a sync cycle never clobbers the operator's selection.
    """
    active = read_active_context()
    if active is not None:
        return active
    return read_cached_context()


# ---------------------------------------------------------------------------
# Sync pull — downloads device context from server
# ---------------------------------------------------------------------------

async def pull_device_context() -> dict | None:
    """Fetch the device context from the server and cache it locally.

    Returns the context dict on success, None on failure (last cached
    value remains untouched on disk so the robot keeps the previous state).
    This function writes ONLY to device_context.json — it never touches
    active_context.json so the operator's sticky selection is preserved.
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


async def pull_catalog() -> bool:
    """Fetch all empresas and fundos from the server and upsert locally.

    Populates the local catalog so operators can browse and select
    org hierarchy even when offline. Does NOT delete local-only records
    (created offline) — those will be pushed via sync_push.

    Returns True on success, False on failure.
    """
    url = f"{config.sync.server_url}/api/sync/catalog"
    headers = {"Authorization": f"Bearer {config.sync.api_key}"}

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning(
                        "Sync pull catalog: server returned status %d", resp.status
                    )
                    return False
                data = await resp.json()
    except Exception as exc:
        logger.warning("Sync pull catalog failed: %s", exc)
        return False

    empresas = data.get("empresas", [])
    fundos = data.get("fundos", [])

    async with AsyncSessionLocal() as session:
        for emp in empresas:
            result = await session.execute(
                select(Empresa).where(Empresa.uuid == emp["uuid"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.name = emp["name"]
            else:
                session.add(Empresa(uuid=emp["uuid"], name=emp["name"]))

        for fnd in fundos:
            result = await session.execute(
                select(Fundo).where(Fundo.uuid == fnd["uuid"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.name = fnd["name"]
                existing.region = fnd.get("region")
                existing.empresa_uuid = fnd["empresa_uuid"]
            else:
                session.add(Fundo(
                    uuid=fnd["uuid"],
                    empresa_uuid=fnd["empresa_uuid"],
                    name=fnd["name"],
                    region=fnd.get("region"),
                ))

        await session.commit()

    logger.info(
        "Sync pull catalog: upserted %d empresas, %d fundos",
        len(empresas),
        len(fundos),
    )
    return True


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
