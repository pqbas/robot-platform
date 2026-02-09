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
    """Called on app startup — creates any new tables and migrates schema."""
    from sqlalchemy import inspect, text

    from back.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Add polygon column to locations if missing (migration for existing DBs)
        def _migrate(sync_conn):  # type: ignore[no-untyped-def]
            cols = [c["name"] for c in inspect(sync_conn).get_columns("locations")]
            if "polygon" not in cols:
                sync_conn.execute(text("ALTER TABLE locations ADD COLUMN polygon TEXT"))

        await conn.run_sync(_migrate)


async def close_db() -> None:
    """Dispose the engine connection pool on shutdown."""
    await engine.dispose()
