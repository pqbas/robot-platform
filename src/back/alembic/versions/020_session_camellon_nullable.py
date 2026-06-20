"""Make sessions.camellon_id nullable (save without location).

A counting session can now be saved without choosing empresa/fundo/camellon —
the operator assigns the location later via the session edit dialog. The FK to
camellones is kept; only the NOT NULL is dropped.

On SQLite this is a manual table rebuild rather than ``batch_alter_table``: the
live ``sessions`` table carries a dangling foreign key to ``_camellones_old``
(leftover from migration 015's batch rebuild of ``camellones``), so alembic's
reflective batch mode fails with ``NoSuchTableError: _camellones_old``. The
hand rebuild both drops the NOT NULL and repairs the FK to point at
``camellones``.

Revision ID: 020
Revises: 019
Create Date: 2026-06-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _sqlite_camellon_notnull(conn) -> bool:
    """True if sessions.camellon_id is currently NOT NULL on SQLite."""
    rows = conn.execute(sa.text("PRAGMA table_info(sessions)")).fetchall()
    for r in rows:
        # (cid, name, type, notnull, dflt_value, pk)
        if r[1] == "camellon_id":
            return bool(r[3])
    return False


# Column list of the live sessions table (id..recording_uuid), in order. Used to
# copy rows across the rebuild without naming them twice.
_COLS = (
    "id, camellon_id, start_time, end_time, target_class, "
    "total_count, uuid, device_id, recording_uuid"
)


def _rebuild_sessions_sqlite(conn, *, camellon_nullable: bool) -> None:
    camellon_def = "camellon_id INTEGER" + ("" if camellon_nullable else " NOT NULL")
    conn.execute(sa.text("ALTER TABLE sessions RENAME TO _sessions_old"))
    conn.execute(sa.text(f"""
        CREATE TABLE sessions (
            id INTEGER NOT NULL,
            {camellon_def},
            start_time TEXT NOT NULL,
            end_time TEXT,
            target_class TEXT NOT NULL,
            total_count INTEGER DEFAULT '0',
            uuid TEXT,
            device_id TEXT,
            recording_uuid TEXT,
            PRIMARY KEY (id),
            FOREIGN KEY(camellon_id) REFERENCES camellones (id)
        )
    """))
    conn.execute(sa.text(
        f"INSERT INTO sessions ({_COLS}) SELECT {_COLS} FROM _sessions_old"
    ))
    conn.execute(sa.text("DROP TABLE _sessions_old"))


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        if not _sqlite_camellon_notnull(conn):
            return  # already nullable
        _rebuild_sessions_sqlite(conn, camellon_nullable=True)
    else:
        op.alter_column(
            "sessions", "camellon_id", existing_type=sa.Integer(), nullable=True
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        if _sqlite_camellon_notnull(conn):
            return  # already NOT NULL
        _rebuild_sessions_sqlite(conn, camellon_nullable=False)
    else:
        op.alter_column(
            "sessions", "camellon_id", existing_type=sa.Integer(), nullable=False
        )
