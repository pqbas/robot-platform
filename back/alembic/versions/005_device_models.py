"""Add device_models assignment table

Revision ID: 005
Revises: 004
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_models",
        sa.Column("device_id", sa.Text(), nullable=False),
        sa.Column("model_uuid", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["model_uuid"], ["detection_models.uuid"]),
        sa.PrimaryKeyConstraint("device_id", "model_uuid"),
    )


def downgrade() -> None:
    op.drop_table("device_models")
