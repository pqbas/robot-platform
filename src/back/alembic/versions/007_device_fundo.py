"""Add fundo_uuid to devices

Revision ID: 007
Revises: 006
Create Date: 2026-04-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.add_column(
            sa.Column(
                "fundo_uuid",
                sa.Text(),
                sa.ForeignKey("fundos.uuid", name="fk_devices_fundo_uuid"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_column("fundo_uuid")
