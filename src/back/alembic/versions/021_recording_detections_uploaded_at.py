"""Add recordings.detections_uploaded_at (sidecar upload tracking).

The {uuid}.jsonl detection sidecar is written incrementally by the
counting-worker AFTER the recording ends. The blob upload was gated only on the
MP4's ``uploaded_at``, so it could fire mid-count and ship a TRUNCATED sidecar
to the server — the replay then froze all bboxes at the last logged frame.
Once ``uploaded_at`` was set the sidecar was never re-sent, so the server kept
the partial file forever.

This column decouples sidecar upload from the MP4: NULL + ``count_status='done'``
means the (now complete) sidecar still needs pushing. It is robot-local
bookkeeping and is never synced. Born NULL for every existing row, so all
already-counted recordings re-push their complete sidecar on the next cycle —
repairing previously-truncated server copies automatically.

Revision ID: 021
Revises: 020
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(conn, table: str, column: str) -> bool:
    insp = sa.inspect(conn)
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_column(conn, "recordings", "detections_uploaded_at"):
        op.add_column(
            "recordings",
            sa.Column("detections_uploaded_at", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _has_column(conn, "recordings", "detections_uploaded_at"):
        op.drop_column("recordings", "detections_uploaded_at")
