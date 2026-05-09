"""Automated tests for auth-protected and public endpoints.

Coverage required by validation.md:
- GET /api/dashboard/stats without auth → 401
- GET /api/dashboard/stats with valid JWT → 200
- GET /api/sync/health without auth → 200 (public)
- GET /api/sync/pull without device key → 401
"""

import pytest


@pytest.mark.asyncio
async def test_dashboard_stats_requires_auth(client):
    resp = await client.get("/api/dashboard/stats")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"


@pytest.mark.asyncio
async def test_dashboard_stats_with_valid_jwt(client, admin_token):
    resp = await client.get(
        "/api/dashboard/stats",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


@pytest.mark.asyncio
async def test_sync_health_is_public(client):
    resp = await client.get("/api/sync/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


@pytest.mark.asyncio
async def test_sync_pull_requires_device_key(client):
    resp = await client.post("/api/sync/pull")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
