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


@router.post("/setup")
async def setup(data: SetupRequest):
    """Configure robot connection to server. Only available in robot mode."""
    if config.mode != AppMode.ROBOT:
        raise HTTPException(status_code=403, detail="Setup only available in robot mode")

    if not data.server_url.strip() or not data.api_key.strip():
        raise HTTPException(status_code=400, detail="Server URL and API Key are required")

    # Find the env file to update
    env_file = os.getenv("ENV_FILE", ".env.robot")
    env_path = Path(env_file)

    if not env_path.exists():
        raise HTTPException(status_code=500, detail=f"Environment file not found: {env_file}")

    # Read existing env file and update values
    lines = env_path.read_text().splitlines()
    updates = {
        "SYNC_SERVER_URL": data.server_url.strip(),
        "SYNC_API_KEY": data.api_key.strip(),
        "ROBOT_ID": data.device_id.strip(),
    }

    new_lines = []
    keys_written = set()
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else None
        if key and key in updates:
            new_lines.append(f"{key}={updates[key]}")
            keys_written.add(key)
        else:
            new_lines.append(line)

    # Add any keys that weren't in the file
    for key, value in updates.items():
        if key not in keys_written:
            new_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(new_lines) + "\n")

    # Update config in memory
    config.sync.server_url = updates["SYNC_SERVER_URL"]
    config.sync.api_key = updates["SYNC_API_KEY"]

    # Start sync loop if not already running
    import asyncio
    from back.services.sync_loop import start_sync_loop
    asyncio.create_task(start_sync_loop())

    return {"ok": True}
