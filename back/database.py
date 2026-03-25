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
    from uuid import uuid4

    from sqlalchemy import inspect, text

    from back.config import get_device_id
    from back.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        def _migrate(sync_conn):  # type: ignore[no-untyped-def]
            insp = inspect(sync_conn)
            device_id = get_device_id()

            # Migrations for each table: add missing columns
            migrations = {
                "locations": ["polygon", "uuid", "device_id"],
                "camellones": ["uuid", "device_id", "fundo_uuid"],
                "sessions": ["uuid", "device_id"],
                "events": ["uuid", "device_id"],
            }

            for table, columns in migrations.items():
                try:
                    existing = [c["name"] for c in insp.get_columns(table)]
                except Exception:
                    continue
                for col in columns:
                    if col not in existing:
                        sync_conn.execute(
                            text(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
                        )

            # Backfill uuid and device_id for existing rows
            for table in ["locations", "camellones", "sessions", "events"]:
                try:
                    rows = sync_conn.execute(
                        text(f"SELECT id FROM {table} WHERE uuid IS NULL")
                    ).fetchall()
                    for row in rows:
                        sync_conn.execute(
                            text(f"UPDATE {table} SET uuid = :uuid, device_id = :did WHERE id = :id"),
                            {"uuid": str(uuid4()), "did": device_id, "id": row[0]},
                        )
                except Exception:
                    pass

        await conn.run_sync(_migrate)


async def close_db() -> None:
    """Dispose the engine connection pool on shutdown."""
    await engine.dispose()
