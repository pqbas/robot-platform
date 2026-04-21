"""Authentication service — JWT for users, API key for devices."""

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import AppMode, config
from back.database import get_db
from back.models import Device, User

bearer_scheme = HTTPBearer(auto_error=False)


# --- Password hashing ---


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# --- API key ---


def generate_api_key() -> str:
    """Generate a random API key prefixed with 'rbt_'."""
    return f"rbt_{secrets.token_hex(24)}"


def hash_api_key(key: str) -> str:
    return bcrypt.hashpw(key.encode(), bcrypt.gensalt()).decode()


def verify_api_key(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# --- JWT ---


def create_access_token(username: str, role: str, empresa_uuid: str | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=config.auth.access_token_expire_minutes)
    payload = {
        "sub": username,
        "role": role,
        "empresa_uuid": empresa_uuid,
        "exp": expire,
    }
    return jwt.encode(payload, config.auth.secret_key, algorithm=config.auth.algorithm)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, config.auth.secret_key, algorithms=[config.auth.algorithm])
        if payload.get("sub") is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# --- FastAPI dependencies ---


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency: extract and validate JWT, return User object."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(credentials.credentials)
    result = await db.execute(select(User).where(User.username == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_role(*roles: str):
    """Dependency factory: require one of the specified roles."""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return _check


async def verify_device_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Device:
    """Dependency: validate robot API key from Authorization header."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required")
    key = credentials.credentials
    result = await db.execute(select(Device).where(Device.is_active == True))  # noqa: E712
    for device in result.scalars().all():
        if verify_api_key(key, device.api_key_hash):
            return device
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


async def get_device_or_none(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Device | None:
    """Dependency: returns the authenticated device in server mode, None in robot mode."""
    if config.mode != AppMode.SERVER:
        return None
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required")
    key = credentials.credentials
    result = await db.execute(select(Device).where(Device.is_active == True))  # noqa: E712
    for device in result.scalars().all():
        if verify_api_key(key, device.api_key_hash):
            return device
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
