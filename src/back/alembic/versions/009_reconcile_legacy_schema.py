"""Reconcile legacy schema drift from init_db's create_all.

Older deploys created tables via ``Base.metadata.create_all()`` (called
from ``init_db()``) before Alembic caught up. Later, ``alembic stamp head``
was used to bring the version table forward, leaving the DB at the
nominal head but **missing the actual ALTER TABLE work** from migrations
006 and 007 (`detection_models.source`, `detection_models.file_hash`
nullability, `devices.fundo_uuid`).

This migration is idempotent: it inspects the live schema and only
touches what's missing. On a clean deploy that walked every revision
in order it's a no-op; on a drifted deploy it brings things back to
match the model.

Revision ID: 009
Revises: 008
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(conn, table: str) -> dict:
    insp = sa.inspect(conn)
    return {c["name"]: c for c in insp.get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()

    # 006: detection_models.source + file_hash nullable
    dm_cols = _columns(conn, "detection_models")
    if "source" not in dm_cols:
        with op.batch_alter_table("detection_models") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "source",
                    sa.Text(),
                    nullable=False,
                    server_default="uploaded",
                )
            )
    fh = dm_cols.get("file_hash")
    if fh is not None and fh.get("nullable") is False:
        with op.batch_alter_table("detection_models") as batch_op:
            batch_op.alter_column(
                "file_hash",
                existing_type=sa.Text(),
                nullable=True,
            )

    # 007: devices.fundo_uuid
    dev_cols = _columns(conn, "devices")
    if "fundo_uuid" not in dev_cols:
        with op.batch_alter_table("devices") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "fundo_uuid",
                    sa.Text(),
                    sa.ForeignKey("fundos.uuid", name="fk_devices_fundo_uuid"),
                    nullable=True,
                )
            )


def downgrade() -> None:
    # No-op: this migration is purely reparative. Reverting it would
    # require knowing whether a particular column came from 006/007 or
    # from a cleanly-walked migration history, which we can't tell.
    pass
