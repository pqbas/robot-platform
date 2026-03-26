"""Full schema: all current models

Revision ID: 002
Revises: 001
Create Date: 2026-03-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Domain models ---

    op.create_table(
        "empresas",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "fruit_types",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "detection_models",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("fruit_type_uuid", sa.Text(), sa.ForeignKey("fruit_types.uuid"), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("file_hash", sa.Text(), nullable=False),
        sa.Column("epochs", sa.Integer(), nullable=True),
        sa.Column("map50", sa.Float(), nullable=True),
        sa.Column("map50_95", sa.Float(), nullable=True),
        sa.Column("precision", sa.Float(), nullable=True),
        sa.Column("recall", sa.Float(), nullable=True),
        sa.Column("dataset_size", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.false()),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "fundos",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("empresa_uuid", sa.Text(), sa.ForeignKey("empresas.uuid"), nullable=False),
        sa.Column("fruit_type_uuid", sa.Text(), sa.ForeignKey("fruit_types.uuid"), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("region", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("api_key_hash", sa.Text(), nullable=False),
        sa.Column("last_sync_at", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.Text(), unique=True, nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="viewer"),
        sa.Column("empresa_uuid", sa.Text(), sa.ForeignKey("empresas.uuid"), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("uuid", sa.Text(), unique=True),
        sa.Column("device_id", sa.Text(), nullable=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("zoom", sa.Integer(), server_default="17"),
        sa.Column("polygon", sa.Text(), nullable=True),
    )

    # --- Alter existing tables from 001 to add new columns ---

    with op.batch_alter_table("camellones") as batch_op:
        batch_op.add_column(sa.Column("uuid", sa.Text(), unique=True))
        batch_op.add_column(sa.Column("device_id", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("fundo_uuid", sa.Text(), sa.ForeignKey("fundos.uuid"), nullable=True))

    with op.batch_alter_table("sessions") as batch_op:
        batch_op.add_column(sa.Column("uuid", sa.Text(), unique=True))
        batch_op.add_column(sa.Column("device_id", sa.Text(), nullable=True))

    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("uuid", sa.Text(), unique=True))
        batch_op.add_column(sa.Column("device_id", sa.Text(), nullable=True))

    # --- Capture and classification models ---

    op.create_table(
        "capture_bursts",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("session_uuid", sa.Text(), nullable=False),
        sa.Column("device_id", sa.Text(), nullable=True),
        sa.Column("captured_at", sa.Text(), nullable=True),
        sa.Column("frame_count", sa.Integer(), server_default="0"),
    )

    op.create_table(
        "capture_frames",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("burst_uuid", sa.Text(), sa.ForeignKey("capture_bursts.uuid"), nullable=False),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "frame_detections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("frame_uuid", sa.Text(), sa.ForeignKey("capture_frames.uuid"), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=True),
        sa.Column("class_name", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
    )

    op.create_table(
        "fruit_crops",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("session_uuid", sa.Text(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("source_frame_uuid", sa.Text(), nullable=True),
        sa.Column("bbox_x", sa.Float(), nullable=False),
        sa.Column("bbox_y", sa.Float(), nullable=False),
        sa.Column("bbox_w", sa.Float(), nullable=False),
        sa.Column("bbox_h", sa.Float(), nullable=False),
        sa.Column("captured_at", sa.Text(), nullable=True),
    )

    op.create_table(
        "fruit_classifications",
        sa.Column("uuid", sa.Text(), primary_key=True),
        sa.Column("crop_uuid", sa.Text(), sa.ForeignKey("fruit_crops.uuid"), nullable=False),
        sa.Column("model_uuid", sa.Text(), nullable=True),
        sa.Column("class_name", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("classified_at", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fruit_classifications")
    op.drop_table("fruit_crops")
    op.drop_table("frame_detections")
    op.drop_table("capture_frames")
    op.drop_table("capture_bursts")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("device_id")
        batch_op.drop_column("uuid")

    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("device_id")
        batch_op.drop_column("uuid")

    with op.batch_alter_table("camellones") as batch_op:
        batch_op.drop_column("fundo_uuid")
        batch_op.drop_column("device_id")
        batch_op.drop_column("uuid")

    op.drop_table("locations")
    op.drop_table("users")
    op.drop_table("devices")
    op.drop_table("fundos")
    op.drop_table("detection_models")
    op.drop_table("fruit_types")
    op.drop_table("empresas")
