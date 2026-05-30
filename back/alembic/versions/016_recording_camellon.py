"""Add camellon_id to recordings.

Revision ID: 016
Revises: 015
Create Date: 2026-05-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists_sqlite(conn, table: str) -> bool:
    rows = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table}
    ).fetchall()
    return len(rows) > 0


def _has_column_sqlite(conn, table: str, column: str) -> bool:
    rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == "sqlite":
        if not _table_exists_sqlite(conn, "recordings"):
            # Fresh DB that never ran migration 008 (e.g. counting.db dev DB).
            # Create the table with camellon_id already present.
            conn.execute(sa.text("""
                CREATE TABLE recordings (
                    uuid TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    session_uuid TEXT,
                    camellon_id INTEGER,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    duration_seconds FLOAT,
                    file_path TEXT NOT NULL,
                    file_size_bytes INTEGER,
                    width INTEGER,
                    height INTEGER,
                    fps FLOAT,
                    uploaded_at TEXT,
                    PRIMARY KEY (uuid),
                    FOREIGN KEY (camellon_id) REFERENCES camellones (id)
                )
            """))
            return
        if _has_column_sqlite(conn, "recordings", "camellon_id"):
            return
        conn.execute(sa.text("ALTER TABLE recordings RENAME TO _recordings_old"))
        conn.execute(sa.text("""
            CREATE TABLE recordings (
                uuid TEXT NOT NULL,
                device_id TEXT NOT NULL,
                session_uuid TEXT,
                camellon_id INTEGER,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                duration_seconds FLOAT,
                file_path TEXT NOT NULL,
                file_size_bytes INTEGER,
                width INTEGER,
                height INTEGER,
                fps FLOAT,
                uploaded_at TEXT,
                PRIMARY KEY (uuid),
                FOREIGN KEY (camellon_id) REFERENCES camellones (id)
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO recordings (
                uuid, device_id, session_uuid, started_at, ended_at,
                duration_seconds, file_path, file_size_bytes, width, height, fps, uploaded_at
            )
            SELECT
                uuid, device_id, session_uuid, started_at, ended_at,
                duration_seconds, file_path, file_size_bytes, width, height, fps, uploaded_at
            FROM _recordings_old
        """))
        conn.execute(sa.text("DROP TABLE _recordings_old"))
    else:
        # PostgreSQL: check column exists then add if needed
        row = conn.execute(sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'recordings' AND column_name = 'camellon_id'"
        )).fetchone()
        if row is None:
            op.add_column("recordings", sa.Column("camellon_id", sa.Integer(), nullable=True))
            op.create_foreign_key(
                "fk_recordings_camellon_id",
                "recordings",
                "camellones",
                ["camellon_id"],
                ["id"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name
    if dialect == "sqlite":
        conn.execute(sa.text("ALTER TABLE recordings RENAME TO _recordings_old"))
        conn.execute(sa.text("""
            CREATE TABLE recordings (
                uuid TEXT NOT NULL,
                device_id TEXT NOT NULL,
                session_uuid TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                duration_seconds FLOAT,
                file_path TEXT NOT NULL,
                file_size_bytes INTEGER,
                width INTEGER,
                height INTEGER,
                fps FLOAT,
                uploaded_at TEXT,
                PRIMARY KEY (uuid)
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO recordings (
                uuid, device_id, session_uuid, started_at, ended_at,
                duration_seconds, file_path, file_size_bytes, width, height, fps, uploaded_at
            )
            SELECT
                uuid, device_id, session_uuid, started_at, ended_at,
                duration_seconds, file_path, file_size_bytes, width, height, fps, uploaded_at
            FROM _recordings_old
        """))
        conn.execute(sa.text("DROP TABLE _recordings_old"))
    else:
        op.drop_constraint("fk_recordings_camellon_id", "recordings", type_="foreignkey")
        op.drop_column("recordings", "camellon_id")
