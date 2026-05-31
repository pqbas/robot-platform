"""Add recording_uuid to sessions.

Revision ID: 017
Revises: 016
Create Date: 2026-05-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column_sqlite(conn, table: str, column: str) -> bool:
    rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == "sqlite":
        if _has_column_sqlite(conn, "sessions", "recording_uuid"):
            return
        conn.execute(sa.text("ALTER TABLE sessions ADD COLUMN recording_uuid TEXT"))
    else:
        row = conn.execute(sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'sessions' AND column_name = 'recording_uuid'"
        )).fetchone()
        if row is None:
            op.add_column("sessions", sa.Column("recording_uuid", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name
    if dialect == "sqlite":
        # SQLite does not support DROP COLUMN before 3.35; leave the column in place.
        return
    op.drop_column("sessions", "recording_uuid")
