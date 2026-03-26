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
    from pathlib import Path

    from back.models import Base

    # Ensure data directories exist
    Path(config.storage.models_dir).mkdir(parents=True, exist_ok=True)
    Path(config.storage.frames_dir).mkdir(parents=True, exist_ok=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Dispose the engine connection pool on shutdown."""
    await engine.dispose()
