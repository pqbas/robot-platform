"""Make sessions.target_class nullable (session without a detector).

The Vision page now records with a single start/stop button: if no detector is
configured the session is stored with ``target_class = NULL`` — a plain video,
countable later via recount once a model is picked.

On SQLite this is a manual table rebuild for the same reason as migration 020:
the live ``sessions`` table came out of that rebuild, and alembic's reflective
batch mode still trips over the leftover ``_camellones_old`` reference.

Revision ID: 023
Revises: 022
Create Date: 2026-09-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _sqlite_target_class_notnull(conn) -> bool:
    """True if sessions.target_class is currently NOT NULL on SQLite."""
    rows = conn.execute(sa.text("PRAGMA table_info(sessions)")).fetchall()
    for r in rows:
        # (cid, name, type, notnull, dflt_value, pk)
        if r[1] == "target_class":
            return bool(r[3])
    return False


# Column list of the live sessions table (post-020), in order.
_COLS = (
    "id, camellon_id, start_time, end_time, target_class, "
    "total_count, uuid, device_id, recording_uuid"
)


def _rebuild_sessions_sqlite(conn, *, target_class_nullable: bool) -> None:
    target_def = "target_class TEXT" + ("" if target_class_nullable else " NOT NULL")
    conn.execute(sa.text("ALTER TABLE sessions RENAME TO _sessions_old"))
    conn.execute(sa.text(f"""
        CREATE TABLE sessions (
            id INTEGER NOT NULL,
            camellon_id INTEGER,
            start_time TEXT NOT NULL,
            end_time TEXT,
            {target_def},
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
        if not _sqlite_target_class_notnull(conn):
            return  # already nullable
        _rebuild_sessions_sqlite(conn, target_class_nullable=True)
    else:
        op.alter_column(
            "sessions", "target_class", existing_type=sa.Text(), nullable=True
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "sqlite":
        if _sqlite_target_class_notnull(conn):
            return  # already NOT NULL
        # Rows without a detector have no class to restore; park them under a
        # placeholder so the NOT NULL can come back.
        conn.execute(sa.text(
            "UPDATE sessions SET target_class = '' WHERE target_class IS NULL"
        ))
        _rebuild_sessions_sqlite(conn, target_class_nullable=False)
    else:
        conn.execute(sa.text(
            "UPDATE sessions SET target_class = '' WHERE target_class IS NULL"
        ))
        op.alter_column(
            "sessions", "target_class", existing_type=sa.Text(), nullable=False
        )
