"""Setup endpoints for first-time robot configuration."""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from back.config import AppMode, config

router = APIRouter(prefix="/api/config", tags=["setup"])


_DEFAULT_VALUES = {"", "http://localhost:9090", "dev-sync-key"}


@router.get("/setup-status")
async def setup_status():
    """Check if the robot is configured (has real server URL and API key).

    En server mode el endpoint es publico (frontend lo consume pre-login),
    asi que solo devolvemos `mode` para minimizar info disclosure. El campo
    `configured` solo aplica en modo robot (sync hacia un server externo).
    """
    if config.mode == AppMode.SERVER:
        return {"mode": "server"}
    url = config.sync.server_url.strip()
    key = config.sync.api_key.strip()
    configured = url not in _DEFAULT_VALUES and key not in _DEFAULT_VALUES
    return {"configured": configured, "mode": config.mode.value}


class SetupRequest(BaseModel):
    server_url: str
    device_id: str
    api_key: str


def _write_env(updates: dict[str, str]) -> None:
    """Persist key=value pairs to the active env file, updating in place."""
    env_file = os.getenv("ENV_FILE", ".env.robot")
    env_path = Path(env_file)

    if not env_path.exists():
        raise HTTPException(status_code=500, detail=f"Environment file not found: {env_file}")

    lines = env_path.read_text().splitlines()
    new_lines = []
    keys_written = set()
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else None
        if key and key in updates:
            new_lines.append(f"{key}={updates[key]}")
            keys_written.add(key)
        else:
            new_lines.append(line)

    # Add any keys that weren't already in the file
    for key, value in updates.items():
        if key not in keys_written:
            new_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(new_lines) + "\n")


@router.post("/setup")
async def setup(data: SetupRequest):
    """Configure robot connection to server. Only available in robot mode."""
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=403, detail="Setup only available in robot mode")

    if not data.server_url.strip() or not data.api_key.strip():
        raise HTTPException(status_code=400, detail="Server URL and API Key are required")

    updates = {
        "SYNC_SERVER_URL": data.server_url.strip(),
        "SYNC_API_KEY": data.api_key.strip(),
        "ROBOT_ID": data.device_id.strip(),
    }
    _write_env(updates)

    # Update config in memory
    config.sync.server_url = updates["SYNC_SERVER_URL"]
    config.sync.api_key = updates["SYNC_API_KEY"]

    # Start sync loop if not already running
    import asyncio
    from back.services.sync_loop import start_sync_loop
    asyncio.create_task(start_sync_loop())

    return {"ok": True}


class LanUrlRequest(BaseModel):
    lan_url: str


@router.get("/lan-url")
async def get_lan_url():
    """Return the current LAN URL used to upload recordings over the LAN.

    Robot-only. The value is not a secret, so it is returned to prefill the
    settings field (unlike the API key).
    """
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=403, detail="Solo disponible en modo robot")
    return {"lan_url": config.sync.lan_url}


@router.post("/lan-url")
async def set_lan_url(data: LanUrlRequest):
    """Set (or clear) SYNC_LAN_URL — the server's LAN address for direct video
    upload. Dedicated endpoint so the LAN URL can be changed on its own without
    re-entering server_url/api_key (which /setup requires). An empty value
    disables LAN upload and falls back to uploading over the internet.

    Takes effect immediately: upload_pending_recordings reads
    config.sync.lan_url fresh each sync cycle, no restart needed.
    """
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=403, detail="Solo disponible en modo robot")

    url = data.lan_url.strip()
    if url and not url.startswith(("http://", "https://")):
        url = f"http://{url}"

    _write_env({"SYNC_LAN_URL": url})
    config.sync.lan_url = url

    return {"ok": True, "lan_url": url}
