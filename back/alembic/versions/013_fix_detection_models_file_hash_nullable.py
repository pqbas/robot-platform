"""Make detection_models.file_hash nullable for library models.

Revision ID: 013
Revises: 012
Create Date: 2026-05-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table(
        "detection_models",
        reflect_args=[sa.Column("source", sa.String(), server_default=sa.text("'uploaded'"))],
    ) as batch_op:
        batch_op.alter_column("file_hash", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table(
        "detection_models",
        reflect_args=[sa.Column("source", sa.String(), server_default=sa.text("'uploaded'"))],
    ) as batch_op:
        batch_op.alter_column("file_hash", existing_type=sa.Text(), nullable=False)
