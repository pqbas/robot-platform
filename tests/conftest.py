"""Fixtures for the test suite.

Tests run in server mode with an in-memory SQLite database so they need no
PostgreSQL instance. The environment variables must be set BEFORE any back.*
module is imported (config.py reads them at module level).
"""

import os

# Set env vars before any back.* import
os.environ.setdefault("ROBOT_MODE", "server")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("AUTH_SECRET_KEY", "test-secret-for-pytest-only")

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from back.database import AsyncSessionLocal, engine
from back.models import Base, Device, User
from back.services.auth import create_access_token, hash_api_key, hash_password, generate_api_key


@pytest_asyncio.fixture(scope="session")
async def setup_db():
    """Create all tables once per session."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session(setup_db):
    """Return a clean session; rolls back after each test."""
    async with AsyncSessionLocal() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def admin_user(setup_db):
    """Create a fresh admin user for a test, delete after."""
    async with AsyncSessionLocal() as session:
        user = User(
            username="testadmin",
            password_hash=hash_password("testpass"),
            role="admin",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        yield user
        await session.delete(user)
        await session.commit()


@pytest_asyncio.fixture
def admin_token(admin_user):
    """Return a valid JWT for the admin user."""
    return create_access_token(admin_user.username, admin_user.role)


@pytest_asyncio.fixture
async def device_with_key(setup_db):
    """Create a device with an API key, return (device, raw_key)."""
    raw_key = generate_api_key()
    async with AsyncSessionLocal() as session:
        device = Device(
            id="test-device-001",
            name="Test Robot",
            api_key_hash=hash_api_key(raw_key),
            is_active=True,
        )
        session.add(device)
        await session.commit()
        await session.refresh(device)
        yield device, raw_key
        await session.delete(device)
        await session.commit()


@pytest_asyncio.fixture
async def client(setup_db):
    """Return an AsyncClient wired to the FastAPI app."""
    from back.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
