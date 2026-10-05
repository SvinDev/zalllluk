from fastapi import APIRouter, Response, status
from sqlalchemy import select

from app.auth.deps import CurrentUser, SessionDep
from app.auth.schemas import LoginRequest, PasswordChange, Profile, TokenResponse
from app.core.errors import AuthenticationError, BusinessRuleError
from app.core.security import create_access_token, hash_password, verify_password
from app.housing.schemas import ApartmentRead
from app.housing.service import user_apartments
from app.users.models import User
from app.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

# Хэш-заглушка: проверяем пароль даже для несуществующего email,
# чтобы время ответа не выдавало, зарегистрирован ли адрес.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


@router.post("/login", response_model=TokenResponse, summary="Вход по email и паролю")
async def login(session: SessionDep, data: LoginRequest) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == data.email))
    password_ok = verify_password(data.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not password_ok:
        raise AuthenticationError("Неверный email или пароль")
    if not user.is_active:
        raise AuthenticationError("Учётная запись заблокирована")
    token, ttl = create_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=ttl, user=UserRead.model_validate(user))


@router.get("/me", response_model=Profile, summary="Текущий пользователь")
async def me(session: SessionDep, user: CurrentUser) -> Profile:
    apartments = await user_apartments(session, user)
    return Profile(
        **UserRead.model_validate(user).model_dump(),
        apartments=[ApartmentRead.model_validate(a) for a in apartments],
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT, summary="Сменить пароль")
async def change_password(session: SessionDep, user: CurrentUser, data: PasswordChange) -> Response:
    if not verify_password(data.current_password, user.password_hash):
        raise BusinessRuleError("Текущий пароль указан неверно")
    user.password_hash = hash_password(data.new_password)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
