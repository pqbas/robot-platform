"""Add failed_login_attempts and locked_until to users table.

Revision ID: 011
Revises: 010
Create Date: 2026-05-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")
    with op.batch_alter_table("users") as batch_op:
        if "failed_login_attempts" not in cols:
            batch_op.add_column(
                sa.Column(
                    "failed_login_attempts",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                )
            )
        if "locked_until" not in cols:
            batch_op.add_column(
                sa.Column("locked_until", sa.Text(), nullable=True)
            )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("locked_until")
        batch_op.drop_column("failed_login_attempts")
