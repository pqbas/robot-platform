"""Add sync_log and commands tables

Revision ID: 003
Revises: 002
Create Date: 2026-03-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sync_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("record_uuid", sa.Text(), nullable=False),
        sa.Column("synced_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "commands",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("uuid", sa.Text(), unique=True),
        sa.Column("device_id", sa.Text(), nullable=False),
        sa.Column("command_type", sa.Text(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="pending"),
        sa.Column("created_at", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("commands")
    op.drop_table("sync_log")
