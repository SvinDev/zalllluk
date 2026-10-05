from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.users.models import User, UserRole
from app.users.schemas import UserCreate, UserUpdate


def _ensure_can_manage(actor: User, role: UserRole) -> None:
    """Админ управляет всеми, управляющий — только жителями."""
    if actor.role == UserRole.ADMIN:
        return
    if actor.role == UserRole.MANAGER and role == UserRole.RESIDENT:
        return
    raise PermissionDeniedError("Недостаточно прав для управления этим пользователем")


async def get_user(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError("Пользователь не найден")
    return user


def users_query(*, role: UserRole | None = None, search: str | None = None) -> Select[Any]:
    stmt = select(User).order_by(User.full_name, User.id)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(User.full_name.ilike(pattern), User.email.ilike(pattern), User.phone.ilike(pattern))
        )
    return stmt


async def create_user(session: AsyncSession, actor: User | None, data: UserCreate) -> User:
    if actor is not None:
        _ensure_can_manage(actor, data.role)
    exists = await session.scalar(select(User.id).where(User.email == data.email))
    if exists is not None:
        raise ConflictError("Пользователь с таким email уже существует")
    user = User(
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        role=data.role,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    await session.flush()
    return user


async def update_user(session: AsyncSession, actor: User, user: User, data: UserUpdate) -> User:
    _ensure_can_manage(actor, user.role)
    changes = data.model_dump(exclude_unset=True)
    if "role" in changes:
        _ensure_can_manage(actor, changes["role"])
        if user.id == actor.id and changes["role"] != actor.role:
            raise PermissionDeniedError("Нельзя изменить собственную роль")
    if user.id == actor.id and changes.get("is_active") is False:
        raise PermissionDeniedError("Нельзя заблокировать самого себя")
    password = changes.pop("password", None)
    if password:
        user.password_hash = hash_password(password)
    for field, value in changes.items():
        setattr(user, field, value)
    await session.flush()
    return user
