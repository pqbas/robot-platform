"""Add TensorRT engine fields to detection_models.

Three columns to track per-model TensorRT state on the robot:
- ``tensorrt_enabled`` — operator intent (toggle on /settings)
- ``engine_status`` — build state (pytorch | pending | converting | ready | error)
- ``engine_error`` — last failure message, null otherwise

Idempotent: skip columns that already exist (older deploys may have run
``create_all`` and stamped past this revision).

Revision ID: 010
Revises: 009
Create Date: 2026-04-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "detection_models")
    with op.batch_alter_table("detection_models") as batch_op:
        if "tensorrt_enabled" not in cols:
            batch_op.add_column(
                sa.Column(
                    "tensorrt_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("false"),
                )
            )
        if "engine_status" not in cols:
            batch_op.add_column(
                sa.Column(
                    "engine_status",
                    sa.Text(),
                    nullable=False,
                    server_default="pytorch",
                )
            )
        if "engine_error" not in cols:
            batch_op.add_column(
                sa.Column("engine_error", sa.Text(), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.drop_column("engine_error")
        batch_op.drop_column("engine_status")
        batch_op.drop_column("tensorrt_enabled")
