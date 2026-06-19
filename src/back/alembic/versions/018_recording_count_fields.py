"""Add deferred-counting fields to recordings.

count_status / count / count_error / count_config support the offline
counting-worker: the count is recomputed from the recorded MP4, and
count_config snapshots the config + model identity used (reproducibility).

Revision ID: 018
Revises: 017
Create Date: 2026-06-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column_sqlite(conn, table: str, column: str) -> bool:
    rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def _add_column(conn, table: str, column: sa.Column, ddl: str) -> None:
    dialect = conn.dialect.name
    if dialect == "sqlite":
        if _has_column_sqlite(conn, table, column.name):
            return
        conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    else:
        row = conn.execute(
            sa.text(
                "SELECT 1 FROM information_schema.columns "
                f"WHERE table_name = '{table}' AND column_name = '{column.name}'"
            )
        ).fetchone()
        if row is None:
            op.add_column(table, column)


def upgrade() -> None:
    conn = op.get_bind()
    # count_status NOT NULL default 'none' so existing rows are well-formed.
    _add_column(
        conn,
        "recordings",
        sa.Column(
            "count_status", sa.Text(), nullable=False, server_default="none"
        ),
        "count_status TEXT NOT NULL DEFAULT 'none'",
    )
    _add_column(
        conn,
        "recordings",
        sa.Column("count", sa.Integer(), nullable=True),
        "count INTEGER",
    )
    _add_column(
        conn,
        "recordings",
        sa.Column("count_error", sa.Text(), nullable=True),
        "count_error TEXT",
    )
    _add_column(
        conn,
        "recordings",
        sa.Column("count_config", sa.Text(), nullable=True),
        "count_config TEXT",
    )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        # SQLite does not support DROP COLUMN before 3.35; leave columns in place.
        return
    for col in ("count_config", "count_error", "count", "count_status"):
        op.drop_column("recordings", col)
