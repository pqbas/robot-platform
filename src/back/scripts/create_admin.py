"""Script para crear un usuario admin desde la línea de comandos.

Uso:
    make create-admin
    # o bien:
    ENV_FILE=.env.server uv run python -m back.scripts.create_admin
"""

import asyncio
import getpass
import sys


async def main() -> None:
    # Imports deferred so que la config (ENV_FILE) ya esté cargada cuando
    # este módulo se importa desde la línea de comandos.
    from sqlalchemy import select

    from back.database import AsyncSessionLocal, engine
    from back.models import Base, User
    from back.services.auth import hash_password

    username = input("Username: ").strip()
    if not username:
        print("Error: el username no puede estar vacío.", file=sys.stderr)
        sys.exit(1)

    password = getpass.getpass("Password: ")
    if not password:
        print("Error: el password no puede estar vacío.", file=sys.stderr)
        sys.exit(1)

    confirm = getpass.getpass("Confirmar password: ")
    if password != confirm:
        print("Error: los passwords no coinciden.", file=sys.stderr)
        sys.exit(1)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == username))
        if result.scalar_one_or_none():
            print(f"Error: ya existe un usuario con username '{username}'.", file=sys.stderr)
            sys.exit(1)

        admin = User(
            username=username,
            password_hash=hash_password(password),
            role="admin",
        )
        session.add(admin)
        await session.commit()

    print(f"Usuario admin '{username}' creado correctamente.")


if __name__ == "__main__":
    asyncio.run(main())
