"""Make detection_models.fruit_type_uuid nullable.

Revision ID: 012
Revises: 011
Create Date: 2026-05-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.alter_column(
            "fruit_type_uuid",
            existing_type=sa.Text(),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.alter_column(
            "fruit_type_uuid",
            existing_type=sa.Text(),
            nullable=False,
        )
