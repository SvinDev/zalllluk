from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.announcements.models import Announcement
from app.announcements.schemas import AnnouncementCreate, AnnouncementRead, AnnouncementUpdate
from app.auth.deps import CurrentUser, ManagerUser, SessionDep
from app.core.errors import NotFoundError
from app.core.pagination import Page, PageParams, page_params, paginate
from app.housing.models import Apartment
from app.housing.service import get_building, resident_apartment_ids

router = APIRouter(prefix="/announcements", tags=["announcements"])


async def _get(session: AsyncSession, announcement_id: int) -> Announcement:
    item = await session.get(
        Announcement,
        announcement_id,
        options=[joinedload(Announcement.building)],
        populate_existing=True,
    )
    if item is None:
        raise NotFoundError("Объявление не найдено")
    return item


@router.get("", response_model=Page[AnnouncementRead], summary="Объявления")
async def list_announcements(
    session: SessionDep,
    user: CurrentUser,
    page: Annotated[PageParams, Depends(page_params)],
    building_id: int | None = None,
) -> Page[AnnouncementRead]:
    stmt = (
        select(Announcement)
        .options(joinedload(Announcement.building))
        .order_by(Announcement.is_pinned.desc(), Announcement.published_at.desc())
    )
    ids = await resident_apartment_ids(session, user)
    if ids is not None:
        # Жителю — опубликованные объявления для всех и для его домов.
        own_buildings = select(Apartment.building_id).where(Apartment.id.in_(ids))
        stmt = stmt.where(
            Announcement.published_at <= datetime.now(UTC),
            or_(Announcement.building_id.is_(None), Announcement.building_id.in_(own_buildings)),
        )
    if building_id is not None:
        stmt = stmt.where(
            or_(Announcement.building_id.is_(None), Announcement.building_id == building_id)
        )
    items, total = await paginate(session, stmt, page)
    return Page(
        items=[AnnouncementRead.model_validate(a) for a in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "",
    response_model=AnnouncementRead,
    status_code=status.HTTP_201_CREATED,
    summary="Опубликовать объявление",
)
async def create_announcement(
    session: SessionDep, user: ManagerUser, data: AnnouncementCreate
) -> AnnouncementRead:
    if data.building_id is not None:
        await get_building(session, data.building_id)
    values = data.model_dump(exclude_none=True)
    item = Announcement(**values, author_id=user.id)
    session.add(item)
    await session.commit()
    return AnnouncementRead.model_validate(await _get(session, item.id))


@router.patch("/{announcement_id}", response_model=AnnouncementRead, summary="Изменить объявление")
async def update_announcement(
    session: SessionDep, _: ManagerUser, announcement_id: int, data: AnnouncementUpdate
) -> AnnouncementRead:
    item = await _get(session, announcement_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(item, field, value)
    await session.commit()
    return AnnouncementRead.model_validate(await _get(session, announcement_id))


@router.delete(
    "/{announcement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить объявление",
)
async def delete_announcement(
    session: SessionDep, _: ManagerUser, announcement_id: int
) -> Response:
    await session.delete(await _get(session, announcement_id))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
