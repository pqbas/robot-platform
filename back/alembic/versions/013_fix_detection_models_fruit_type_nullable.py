"""Make detection_models.fruit_type_uuid nullable.

Revision ID: 013
Revises: 012
Create Date: 2026-05-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> dict:
    return {c["name"]: c for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    dm_cols = _columns(conn, "detection_models")
    # fruit_type_uuid may not exist on the robot (column was never added there);
    # only alter if it exists and is currently NOT NULL.
    ft = dm_cols.get("fruit_type_uuid")
    if ft is not None and ft.get("nullable") is False:
        with op.batch_alter_table("detection_models") as batch_op:
            batch_op.alter_column(
                "fruit_type_uuid",
                existing_type=sa.Text(),
                nullable=True,
            )
    # Also ensure selected_label exists (it was added in 012_selected_label;
    # if that migration ran first this is a no-op, but if this file runs
    # before selected_label due to a re-stamp, we still get the column).
    if "selected_label" not in dm_cols:
        with op.batch_alter_table("detection_models") as batch_op:
            batch_op.add_column(sa.Column("selected_label", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.alter_column(
            "fruit_type_uuid",
            existing_type=sa.Text(),
            nullable=False,
        )
