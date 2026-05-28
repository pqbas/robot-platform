"""Add selected_label to detection_models.

Persists the user's last-selected label per model so reloads
(sync_pull, conversion_poller, startup) can re-derive the class
filter instead of wiping it.

Revision ID: 012
Revises: 011
Create Date: 2026-05-15
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "detection_models")
    with op.batch_alter_table("detection_models") as batch_op:
        if "selected_label" not in cols:
            batch_op.add_column(sa.Column("selected_label", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("detection_models") as batch_op:
        batch_op.drop_column("selected_label")
