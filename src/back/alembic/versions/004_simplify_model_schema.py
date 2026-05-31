"""Remove FruitType, simplify DetectionModel with class_mapping

Revision ID: 004
Revises: 003
Create Date: 2026-03-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add class_mapping to detection_models
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.add_column(sa.Column("class_mapping", sa.Text(), nullable=True, server_default="[]"))
        batch_op.drop_column("fruit_type_uuid")
        batch_op.drop_column("object_type")

    # Remove fruit_type_uuid from fundos
    with op.batch_alter_table("fundos") as batch_op:
        batch_op.drop_column("fruit_type_uuid")

    # Drop fruit_types table
    op.drop_table("fruit_types")


def downgrade() -> None:
    op.create_table(
        "fruit_types",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    with op.batch_alter_table("fundos") as batch_op:
        batch_op.add_column(sa.Column("fruit_type_uuid", sa.Text(), nullable=True))

    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.add_column(sa.Column("fruit_type_uuid", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("object_type", sa.Text(), nullable=True))
        batch_op.drop_column("class_mapping")
