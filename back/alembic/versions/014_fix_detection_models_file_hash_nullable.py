"""Make detection_models.file_hash nullable for library models.

Revision ID: 014
Revises: 013
Create Date: 2026-05-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> dict:
    return {c["name"]: c for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    dm_cols = _columns(conn, "detection_models")
    fh = dm_cols.get("file_hash")
    if fh is not None and fh.get("nullable") is False:
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
