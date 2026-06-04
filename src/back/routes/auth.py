"""Authentication routes — login and user info."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.config import config
from back.database import get_db
from back.models import User
from back.services.auth import (
    create_access_token,
    get_current_user,
    verify_password,
)

# Cookie that carries the JWT for requests the SPA can't add an Authorization
# header to (notably <video>/<img> src loads, e.g. recording playback). Not
# Secure-only: the server is reached over plain http on the LAN as well as https
# via Tailscale, and a Secure cookie would be dropped on the http path. SameSite
# is Lax because every consumer is same-origin (served behind the same nginx).
_COOKIE_NAME = "access_token"
from back.services.lockout import is_locked, register_failed_attempt, register_successful_login
from back.services.rate_limit import limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class UserMeResponse(BaseModel):
    id: int
    username: str
    role: str
    empresa_uuid: str | None

    model_config = {"from_attributes": True}


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/5minutes")
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    # Check lockout before any password validation
    if user and user.is_active and is_locked(user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cuenta bloqueada temporalmente. Reintentar más tarde o contactar al admin.",
        )

    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        # Register failed attempt only for existing active users (wrong password)
        if user and user.is_active:
            register_failed_attempt(user)
            await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    register_successful_login(user)
    await db.commit()
    token = create_access_token(user.username, user.role, user.empresa_uuid)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=config.auth.access_token_expire_minutes * 60,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return LoginResponse(access_token=token, role=user.role)


@router.post("/logout")
async def logout(response: Response):
    """Clear the auth cookie. Whitelisted so it works even with an expired token
    (the SPA still drops its localStorage copy of the token separately)."""
    response.delete_cookie(_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserMeResponse)
async def me(user: User = Depends(get_current_user)):
    return user
