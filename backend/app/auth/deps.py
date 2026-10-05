from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import decode_access_token
from app.users.models import STAFF_ROLES, User, UserRole

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_bearer = HTTPBearer(auto_error=False, description="JWT из /api/v1/auth/login")


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise AuthenticationError("Требуется авторизация")
    user_id = decode_access_token(credentials.credentials)
    user = await session.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise AuthenticationError("Сессия недействительна, войдите заново")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], Awaitable[User]]:
    allowed = frozenset(roles)

    async def _dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise PermissionDeniedError("Недостаточно прав для этого действия")
        return user

    return _dependency


StaffUser = Annotated[User, Depends(require_roles(*STAFF_ROLES))]
AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
ManagerUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER))]
AccountantUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT))]
GuardUser = Annotated[
    User, Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SECURITY))
]
