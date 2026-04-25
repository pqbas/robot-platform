from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from back.config import config

engine = create_async_engine(config.database.url, echo=False)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables from ORM models. For production use Alembic migrations."""
    import logging
    from pathlib import Path

    from sqlalchemy import select, text

    from back.config import AppMode
    from back.models import Base, User
    from back.services.auth import hash_password

    logger = logging.getLogger(__name__)

    # Ensure data directories exist
    Path(config.storage.models_dir).mkdir(parents=True, exist_ok=True)
    Path(config.storage.frames_dir).mkdir(parents=True, exist_ok=True)
    Path(config.storage.recordings_dir).mkdir(parents=True, exist_ok=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Strip NUL bytes from device_id values written by old code that didn't
    # sanitize the Jetson devicetree file. Postgres rejects \x00 on push.
    # SQLite's REPLACE/instr/length truncate at the first NUL on TEXT, so we
    # read each row as a BLOB and rewrite it from Python.
    if config.mode == AppMode.ROBOT:
        async with AsyncSessionLocal() as session:
            for table in ("locations", "camellones", "sessions", "events", "capture_bursts"):
                rows = (await session.execute(
                    text(f"SELECT rowid, CAST(device_id AS BLOB) FROM {table}")
                )).all()
                for rowid, blob in rows:
                    if blob is None or b"\x00" not in bytes(blob):
                        continue
                    cleaned = bytes(blob).replace(b"\x00", b"").decode("utf-8")
                    await session.execute(
                        text(f"UPDATE {table} SET device_id = :v WHERE rowid = :r"),
                        {"v": cleaned, "r": rowid},
                    )
            await session.commit()

    # Seed admin user in server mode if no users exist
    if config.mode == AppMode.SERVER:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User))
            if not result.scalar_one_or_none():
                admin = User(
                    username="admin",
                    password_hash=hash_password("admin"),
                    role="admin",
                )
                session.add(admin)
                await session.commit()
                logger.info("Seeded admin user (username=admin, password=admin)")


async def close_db() -> None:
    """Dispose the engine connection pool on shutdown."""
    await engine.dispose()
