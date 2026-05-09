"""Automated tests for auth-protected and public endpoints.

Coverage required by validation.md:
- GET /api/dashboard/stats without auth → 401
- GET /api/dashboard/stats with valid JWT → 200
- GET /api/sync/health without auth → 200 (public)
- GET /api/sync/pull without device key → 401
- Account lockout: 5 failed logins → 6th attempt returns 401 "Cuenta bloqueada"
- Successful login resets failed_login_attempts and locked_until
- Rate limit: 6 login attempts in <5min from same IP → 6th returns 429
- Security headers present on every response
- HSTS present in server mode
"""

import pytest
import pytest_asyncio

from back.database import AsyncSessionLocal
from back.services.lockout import register_failed_attempt


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


# ---------------------------------------------------------------------------
# Account lockout tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lockout_after_five_failed_attempts(client, admin_user):
    """5 failed logins accumulate on the user; 6th attempt returns 401 lockout."""
    # Directly register 4 failed attempts so the 5th HTTP request triggers lockout
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from back.models import User
        result = await session.execute(select(User).where(User.id == admin_user.id))
        user = result.scalar_one()
        for _ in range(4):
            register_failed_attempt(user)
        await session.commit()

    # 5th attempt via HTTP → triggers lockout (failed_login_attempts reaches 5)
    resp = await client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "wrongpassword"},
    )
    assert resp.status_code == 401

    # 6th attempt — even with correct password — must return lockout 401
    resp = await client.post(
        "/api/auth/login",
        json={"username": admin_user.username, "password": "testpass"},
    )
    assert resp.status_code == 401, f"Expected 401 lockout, got {resp.status_code}: {resp.text}"
    assert "bloqueada" in resp.json()["detail"].lower(), (
        f"Expected 'bloqueada' in detail, got: {resp.json()['detail']}"
    )


@pytest.mark.asyncio
async def test_successful_login_resets_lockout_fields(client, setup_db):
    """A successful login zeroes out failed_login_attempts and locked_until."""
    from back.models import User
    from back.services.auth import hash_password
    from sqlalchemy import select

    # Create a user with some failed attempts but not locked
    async with AsyncSessionLocal() as session:
        user = User(
            username="locktest_user",
            password_hash=hash_password("correct_pass"),
            role="viewer",
            failed_login_attempts=3,
            locked_until=None,
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    try:
        resp = await client.post(
            "/api/auth/login",
            json={"username": "locktest_user", "password": "correct_pass"},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            refreshed = result.scalar_one()
            assert refreshed.failed_login_attempts == 0, (
                f"Expected 0 failed attempts, got {refreshed.failed_login_attempts}"
            )
            assert refreshed.locked_until is None, (
                f"Expected locked_until=None, got {refreshed.locked_until}"
            )
    finally:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            u = result.scalar_one_or_none()
            if u:
                await session.delete(u)
                await session.commit()


# ---------------------------------------------------------------------------
# Rate limit test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limit_login(client, setup_db):
    """6 login attempts in quick succession from same IP → 6th returns 429."""
    from back.services.rate_limit import limiter

    # Reset limiter state so prior tests don't bleed in
    limiter.reset()

    # Use a non-existent username so no DB side-effects
    payload = {"username": "nonexistent_user_rl", "password": "anypass"}

    for i in range(5):
        resp = await client.post("/api/auth/login", json=payload)
        # Should be 401 (wrong credentials), not 429
        assert resp.status_code == 401, (
            f"Attempt {i+1}: Expected 401, got {resp.status_code}: {resp.text}"
        )

    # 6th attempt should be rate-limited
    resp = await client.post("/api/auth/login", json=payload)
    assert resp.status_code == 429, (
        f"Expected 429 on 6th attempt, got {resp.status_code}: {resp.text}"
    )

    # Reset again so subsequent tests are clean
    limiter.reset()


# ---------------------------------------------------------------------------
# Security headers tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_security_headers_present(client):
    """Every response includes the three non-HSTS security headers."""
    resp = await client.get("/api/sync/health")
    assert resp.headers.get("X-Content-Type-Options") == "nosniff", (
        f"Missing or wrong X-Content-Type-Options: {resp.headers}"
    )
    assert resp.headers.get("X-Frame-Options") == "DENY", (
        f"Missing or wrong X-Frame-Options: {resp.headers}"
    )
    assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin", (
        f"Missing or wrong Referrer-Policy: {resp.headers}"
    )


@pytest.mark.asyncio
async def test_hsts_present_in_server_mode(client):
    """In server mode, HSTS header must be present."""
    from back.config import AppMode, config as app_config

    if app_config.mode != AppMode.SERVER:
        pytest.skip("HSTS test only applies to server mode")

    resp = await client.get("/api/sync/health")
    hsts = resp.headers.get("Strict-Transport-Security", "")
    assert "max-age=31536000" in hsts, (
        f"Expected HSTS header with max-age=31536000, got: {hsts!r}"
    )
    assert "includeSubDomains" in hsts, (
        f"Expected HSTS with includeSubDomains, got: {hsts!r}"
    )
