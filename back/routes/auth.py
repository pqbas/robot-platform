"""Authentication routes — login and user info."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.models import User
from back.services.auth import (
    create_access_token,
    get_current_user,
    verify_password,
)

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
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(user.username, user.role, user.empresa_uuid)
    return LoginResponse(access_token=token, role=user.role)


@router.get("/me", response_model=UserMeResponse)
async def me(user: User = Depends(get_current_user)):
    return user
