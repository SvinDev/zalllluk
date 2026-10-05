from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.auth.deps import ManagerUser, SessionDep
from app.core.pagination import Page, PageParams, page_params, paginate
from app.users import service
from app.users.models import UserRole
from app.users.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[UserRead], summary="Список пользователей")
async def list_users(
    session: SessionDep,
    _: ManagerUser,
    page: Annotated[PageParams, Depends(page_params)],
    role: UserRole | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[UserRead]:
    items, total = await paginate(session, service.users_query(role=role, search=search), page)
    return Page(
        items=[UserRead.model_validate(u) for u in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "", response_model=UserRead, status_code=status.HTTP_201_CREATED, summary="Создать пользователя"
)
async def create_user(session: SessionDep, actor: ManagerUser, data: UserCreate) -> UserRead:
    user = await service.create_user(session, actor, data)
    await session.commit()
    return UserRead.model_validate(user)


@router.get("/{user_id}", response_model=UserRead, summary="Пользователь")
async def get_user(session: SessionDep, _: ManagerUser, user_id: int) -> UserRead:
    return UserRead.model_validate(await service.get_user(session, user_id))


@router.patch("/{user_id}", response_model=UserRead, summary="Изменить пользователя")
async def update_user(
    session: SessionDep, actor: ManagerUser, user_id: int, data: UserUpdate
) -> UserRead:
    user = await service.get_user(session, user_id)
    user = await service.update_user(session, actor, user, data)
    await session.commit()
    return UserRead.model_validate(user)
