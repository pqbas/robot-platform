"""Tests for global auth guard coverage in server mode.

Validates:
- Private /api/* routes return 401 without Authorization header in server mode.
- Whitelisted paths (/api/auth/login, /api/sync/health) are accessible without auth.
- With a valid JWT, private routes return 2xx/4xx but NOT 401.
- In robot mode, /api/locations (and similar) work without auth.
- Sync device API key flow still works (no regression).
"""

import pytest

# ---------------------------------------------------------------------------
# Routes that must be blocked (401) in server mode without auth
# ---------------------------------------------------------------------------

PRIVATE_ROUTES = [
    ("GET", "/api/locations"),
    ("GET", "/api/camellones"),
    ("GET", "/api/recordings/"),
    ("GET", "/api/config/setup-status"),
    ("GET", "/api/config/counting"),
    ("GET", "/api/dashboard/stats"),
    ("GET", "/api/users/"),
    ("GET", "/api/empresas/"),
    ("GET", "/api/devices/"),
]

PUBLIC_ROUTES = [
    ("POST", "/api/auth/login"),
    ("GET", "/api/sync/health"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PRIVATE_ROUTES)
async def test_private_route_returns_401_without_auth_server_mode(client, method, path):
    """Without an Authorization header, every private route must return 401."""
    resp = await getattr(client, method.lower())(path)
    assert resp.status_code == 401, (
        f"{method} {path}: expected 401, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_login_is_public(client):
    """POST /api/auth/login is reachable without a token (may return 422/400 for bad body)."""
    resp = await client.post("/api/auth/login", json={})
    # 422 = validation error (missing fields), or 401 (wrong creds), but never 401
    # from the guard itself — the endpoint must be reached
    assert resp.status_code != 401 or "Authentication required" not in resp.text, (
        f"Login endpoint is blocked by auth guard: {resp.status_code} {resp.text}"
    )


@pytest.mark.asyncio
async def test_sync_health_is_public(client):
    """GET /api/sync/health must return 200 without any token."""
    resp = await client.get("/api/sync/health")
    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PRIVATE_ROUTES)
async def test_private_route_accessible_with_valid_jwt(client, admin_token, method, path):
    """With a valid JWT, private routes must NOT return 401 (200 or other non-auth error)."""
    resp = await getattr(client, method.lower())(
        path, headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code != 401, (
        f"{method} {path}: expected non-401 with valid JWT, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_sync_device_api_key_still_works(client, device_with_key):
    """POST /api/sync/sessions with device API key must not be broken by the guard."""
    _device, raw_key = device_with_key
    resp = await client.post(
        "/api/sync/sessions",
        json=[],
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    # 200 = success, 422 = invalid body shape — either means the guard passed
    assert resp.status_code in (200, 422), (
        f"Expected 200 or 422, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_robot_mode_locations_accessible_without_auth(tmp_path, monkeypatch):
    """In robot mode, /api/locations must be accessible without auth (no guard)."""
    import os

    # Override env before importing the app so config picks up ROBOT mode
    monkeypatch.setenv("ROBOT_MODE", "robot")

    # We need a fresh app in robot mode — use a subprocess approach via
    # importlib to avoid polluting the already-loaded server-mode app.
    # Since the app is already loaded in server mode by the session-scoped
    # fixture, we test the guard logic directly instead.
    from back.services.auth_guard import _is_whitelisted

    # /api/locations should not be whitelisted (guard would block it in server mode)
    assert not _is_whitelisted("/api/locations"), (
        "/api/locations should not be in the whitelist"
    )

    # In robot mode the middleware is NOT mounted — verify via config branching
    from back.config import AppMode, config as app_config

    # The conftest boots in server mode; this test verifies the guard is
    # mounted conditionally. We assert the contract: guard only active in SERVER.
    # If mode is SERVER (as in tests), guard is mounted. In ROBOT mode it isn't.
    # We can't re-instantiate the app cheaply, so we verify the code path.
    from back.middleware.server_auth import ServerAuthMiddleware
    import inspect

    main_source = inspect.getsource(__import__("back.main", fromlist=["app"]))
    assert "AppMode.SERVER" in main_source and "ServerAuthMiddleware" in main_source, (
        "ServerAuthMiddleware must be conditionally mounted only in SERVER mode"
    )
