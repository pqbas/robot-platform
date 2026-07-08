"""Categories hub + classifier library + classification columns.

Schema only — NO data backfill here. Categories are seeded in-process at startup
(``reconcile_categories``) where ``config`` and the robot-only
``counting_methods.json`` resolve correctly; doing it inside a migration would
diverge between the robot (sqlite, has the file) and the server (postgres,
doesn't) and would fragilely import app config under ENV_FILE=/dev/null.

Creates:
- ``categories`` — the deployment hub (detector + classifier + counting geometry
  per object).
- ``classification_models`` — the classifier library (mirror of detection_models).

Adds:
- ``fruit_crops.recording_uuid`` (+ ``session_uuid`` made nullable).
- ``recordings`` classification lifecycle columns.

Revision ID: 022
Revises: 021
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(conn, table: str) -> bool:
    return sa.inspect(conn).has_table(table)


def _has_column(conn, table: str, column: str) -> bool:
    insp = sa.inspect(conn)
    return any(c["name"] == column for c in insp.get_columns(table))


def _is_not_nullable(conn, table: str, column: str) -> bool:
    insp = sa.inspect(conn)
    for c in insp.get_columns(table):
        if c["name"] == column:
            return not c["nullable"]
    return False


def upgrade() -> None:
    conn = op.get_bind()

    if not _has_table(conn, "classification_models"):
        op.create_table(
            "classification_models",
            sa.Column("uuid", sa.Text(), primary_key=True),
            sa.Column("version", sa.Text(), nullable=False),
            sa.Column("filename", sa.Text(), nullable=False),
            sa.Column("file_hash", sa.Text(), nullable=True),
            sa.Column(
                "source", sa.Text(), nullable=False, server_default="uploaded"
            ),
            sa.Column(
                "class_names", sa.Text(), nullable=False, server_default="[]"
            ),
            sa.Column(
                "num_classes", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "latent_dim", sa.Integer(), nullable=False, server_default="128"
            ),
            sa.Column(
                "imgsz", sa.Integer(), nullable=False, server_default="128"
            ),
            sa.Column("created_at", sa.Text(), nullable=True),
        )

    if not _has_table(conn, "categories"):
        op.create_table(
            "categories",
            sa.Column("name", sa.Text(), primary_key=True),
            sa.Column(
                "detection_model_uuid",
                sa.Text(),
                sa.ForeignKey("detection_models.uuid"),
                nullable=True,
            ),
            sa.Column(
                "classification_model_uuid",
                sa.Text(),
                sa.ForeignKey("classification_models.uuid"),
                nullable=True,
            ),
            sa.Column(
                "method", sa.Text(), nullable=False, server_default="single"
            ),
            sa.Column(
                "count_mode",
                sa.Text(),
                nullable=False,
                server_default="horizontal",
            ),
            sa.Column(
                "threshold", sa.Float(), nullable=False, server_default="0.5"
            ),
            sa.Column(
                "direction",
                sa.Text(),
                nullable=False,
                server_default="left2right",
            ),
            sa.Column(
                "roi_mode", sa.Text(), nullable=False, server_default="square"
            ),
            sa.Column(
                "confidence", sa.Float(), nullable=False, server_default="0.25"
            ),
            sa.Column("updated_at", sa.Text(), nullable=True),
        )

    if _has_table(conn, "fruit_crops"):
        if not _has_column(conn, "fruit_crops", "recording_uuid"):
            op.add_column(
                "fruit_crops",
                sa.Column("recording_uuid", sa.Text(), nullable=True),
            )
        # Crops are now produced per-recording (a Session may not exist yet), so
        # session_uuid becomes nullable. It was NOT NULL since migration 002.
        if _is_not_nullable(conn, "fruit_crops", "session_uuid"):
            with op.batch_alter_table("fruit_crops") as batch:
                batch.alter_column(
                    "session_uuid", existing_type=sa.Text(), nullable=True
                )

    rec_cols = {
        "classification_status": sa.Column(
            "classification_status",
            sa.Text(),
            nullable=False,
            server_default="none",
        ),
        "classification_error": sa.Column(
            "classification_error", sa.Text(), nullable=True
        ),
        "classification_config": sa.Column(
            "classification_config", sa.Text(), nullable=True
        ),
        "classifications_uploaded_at": sa.Column(
            "classifications_uploaded_at", sa.Text(), nullable=True
        ),
        "crops_uploaded_at": sa.Column(
            "crops_uploaded_at", sa.Text(), nullable=True
        ),
    }
    for name, col in rec_cols.items():
        if not _has_column(conn, "recordings", name):
            op.add_column("recordings", col)


def downgrade() -> None:
    conn = op.get_bind()
    for name in (
        "crops_uploaded_at",
        "classifications_uploaded_at",
        "classification_config",
        "classification_error",
        "classification_status",
    ):
        if _has_column(conn, "recordings", name):
            op.drop_column("recordings", name)

    if _has_column(conn, "fruit_crops", "recording_uuid"):
        op.drop_column("fruit_crops", "recording_uuid")

    if _has_table(conn, "categories"):
        op.drop_table("categories")
    if _has_table(conn, "classification_models"):
        op.drop_table("classification_models")
