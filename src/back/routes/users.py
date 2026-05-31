"""User management routes — admin only."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from back.database import get_db
from back.models import User
from back.services.auth import hash_password, require_role

router = APIRouter(prefix="/api/users", tags=["users"])
admin_dep = require_role("admin")


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"
    empresa_uuid: str | None = None


class UserUpdate(BaseModel):
    role: str | None = None
    empresa_uuid: str | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    empresa_uuid: str | None
    is_active: bool
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(User))
    return result.scalars().all()


@router.post("/", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    # Check unique username
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        empresa_uuid=body.empresa_uuid,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        user.role = body.role
    if body.empresa_uuid is not None:
        user.empresa_uuid = body.empresa_uuid
    if body.is_active is not None:
        user.is_active = body.is_active
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def deactivate_user(user_id: int, db: AsyncSession = Depends(get_db), _=Depends(admin_dep)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    await db.commit()
