"""initial tables

Revision ID: 001
Revises:
Create Date: 2026-02-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "camellones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nombre", sa.Text(), nullable=False, unique=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "camellon_id",
            sa.Integer(),
            sa.ForeignKey("camellones.id"),
            nullable=False,
        ),
        sa.Column("start_time", sa.Text(), nullable=False),
        sa.Column("end_time", sa.Text(), nullable=True),
        sa.Column("target_class", sa.Text(), nullable=False),
        sa.Column("total_count", sa.Integer(), server_default="0"),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("sessions.id"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("object_class", sa.Text(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("events")
    op.drop_table("sessions")
    op.drop_table("camellones")
