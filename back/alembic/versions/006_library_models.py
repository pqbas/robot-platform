"""Add source column for library models, make file_hash nullable

Revision ID: 006
Revises: 005
Create Date: 2026-04-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.add_column(
            sa.Column("source", sa.Text(), nullable=False, server_default="uploaded"),
        )
        batch_op.alter_column(
            "file_hash",
            existing_type=sa.Text(),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.alter_column(
            "file_hash",
            existing_type=sa.Text(),
            nullable=False,
        )
        batch_op.drop_column("source")
