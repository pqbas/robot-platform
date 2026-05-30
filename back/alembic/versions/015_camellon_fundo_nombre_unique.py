"""Replace nombre-only unique on camellones with composite (fundo_uuid, nombre).

Revision ID: 015
Revises: 014
Create Date: 2026-05-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_composite_unique(conn) -> bool:
    """Return True if the composite (fundo_uuid, nombre) unique already exists."""
    insp = sa.inspect(conn)
    for uc in insp.get_unique_constraints("camellones"):
        if set(uc["column_names"]) >= {"fundo_uuid", "nombre"}:
            return True
    return False


def _find_nombre_unique_name(conn) -> str | None:
    """Return the explicit name of the nombre-only unique constraint, or None."""
    insp = sa.inspect(conn)
    for uc in insp.get_unique_constraints("camellones"):
        if uc["column_names"] == ["nombre"] and uc["name"]:
            return uc["name"]
    return None


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name

    if _has_composite_unique(conn):
        return  # idempotent

    if dialect == "sqlite":
        # SQLite does not support DROP CONSTRAINT, and batch_alter_table
        # with copy_from only acts when there are actual column operations.
        # We recreate the table manually using the rename-table pattern.
        conn.execute(sa.text("ALTER TABLE camellones RENAME TO _camellones_old"))
        conn.execute(sa.text("""
            CREATE TABLE camellones (
                id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                lat FLOAT,
                lng FLOAT,
                uuid TEXT UNIQUE,
                device_id TEXT,
                fundo_uuid TEXT,
                PRIMARY KEY (id),
                UNIQUE (fundo_uuid, nombre)
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO camellones (id, nombre, lat, lng, uuid, device_id, fundo_uuid)
            SELECT id, nombre, lat, lng, uuid, device_id, fundo_uuid
            FROM _camellones_old
        """))
        conn.execute(sa.text("DROP TABLE _camellones_old"))
    else:
        # Postgres: drop the named constraint, add composite.
        old_name = _find_nombre_unique_name(conn)
        if not old_name:
            old_name = "camellones_nombre_key"  # default Postgres name
        with op.batch_alter_table("camellones") as batch_op:
            batch_op.drop_constraint(old_name, type_="unique")
            batch_op.create_unique_constraint(
                "uq_camellones_fundo_nombre", ["fundo_uuid", "nombre"]
            )


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == "sqlite":
        conn.execute(sa.text("ALTER TABLE camellones RENAME TO _camellones_old"))
        conn.execute(sa.text("""
            CREATE TABLE camellones (
                id INTEGER NOT NULL,
                nombre TEXT NOT NULL UNIQUE,
                lat FLOAT,
                lng FLOAT,
                uuid TEXT UNIQUE,
                device_id TEXT,
                fundo_uuid TEXT,
                PRIMARY KEY (id)
            )
        """))
        conn.execute(sa.text("""
            INSERT INTO camellones (id, nombre, lat, lng, uuid, device_id, fundo_uuid)
            SELECT id, nombre, lat, lng, uuid, device_id, fundo_uuid
            FROM _camellones_old
        """))
        conn.execute(sa.text("DROP TABLE _camellones_old"))
    else:
        with op.batch_alter_table("camellones") as batch_op:
            batch_op.drop_constraint("uq_camellones_fundo_nombre", type_="unique")
            batch_op.create_unique_constraint("camellones_nombre_key", ["nombre"])
