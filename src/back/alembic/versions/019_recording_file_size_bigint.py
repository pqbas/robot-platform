"""Widen recordings.file_size_bytes to BIGINT.

Postgres INTEGER is 32-bit (max ~2.0 GB). Recordings routinely exceed that,
so the sync INSERT failed with "value out of int32 range" and the robot
retried forever. SQLite stores integers as 64-bit dynamically, so it was
never affected and this is a no-op there.

Revision ID: 019
Revises: 018
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        # SQLite uses dynamic 64-bit integer affinity; nothing to widen.
        return
    op.alter_column(
        "recordings",
        "file_size_bytes",
        type_=sa.BigInteger(),
        existing_type=sa.Integer(),
        existing_nullable=True,
    )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        return
    op.alter_column(
        "recordings",
        "file_size_bytes",
        type_=sa.Integer(),
        existing_type=sa.BigInteger(),
        existing_nullable=True,
    )
