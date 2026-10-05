from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.auth.deps import CurrentUser, GuardUser, SessionDep
from app.core.pagination import Page, PageParams, page_params, paginate
from app.housing.service import resident_apartment_ids
from app.passes import service
from app.passes.models import PassKind, PassStatus
from app.passes.schemas import (
    PassCheckResult,
    PassCreate,
    PassDetail,
    PassRead,
    PassReject,
    VisitCreate,
)

router = APIRouter(prefix="/passes", tags=["passes"])


@router.get("", response_model=Page[PassRead], summary="Пропуска")
async def list_passes(
    session: SessionDep,
    user: CurrentUser,
    page: Annotated[PageParams, Depends(page_params)],
    pass_status: Annotated[PassStatus | None, Query(alias="status")] = None,
    kind: PassKind | None = None,
    building_id: int | None = None,
    apartment_id: int | None = None,
    active_now: bool = False,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[PassRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.passes_query(
        ids,
        status=pass_status,
        kind=kind,
        building_id=building_id,
        apartment_id=apartment_id,
        active_now=active_now,
        search=search,
    )
    items, total = await paginate(session, stmt, page)
    return Page(
        items=[PassRead.model_validate(p) for p in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "",
    response_model=PassDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Заказать пропуск",
    description=(
        "Разовый пропуск на срок до суток активируется сразу, остальные ждут согласования УК. "
        "Пропуска, оформленные сотрудниками, активны сразу."
    ),
)
async def create_pass(session: SessionDep, user: CurrentUser, data: PassCreate) -> PassDetail:
    item = await service.create_pass(session, user, data)
    await session.commit()
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, item.id))


@router.get("/check", response_model=list[PassCheckResult], summary="Проверка на посту охраны")
async def check_passes(
    session: SessionDep,
    _: GuardUser,
    code: Annotated[str | None, Query(max_length=16)] = None,
    plate: Annotated[str | None, Query(max_length=20)] = None,
) -> list[PassCheckResult]:
    return await service.check_passes(session, code=code, plate=plate)


@router.get("/{pass_id}", response_model=PassDetail, summary="Пропуск")
async def get_pass(session: SessionDep, user: CurrentUser, pass_id: int) -> PassDetail:
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, pass_id))


@router.post("/{pass_id}/approve", response_model=PassDetail, summary="Согласовать")
async def approve_pass(session: SessionDep, user: GuardUser, pass_id: int) -> PassDetail:
    item = await service.get_pass_for_user(session, user, pass_id)
    await service.approve_pass(session, user, item)
    await session.commit()
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, pass_id))


@router.post("/{pass_id}/reject", response_model=PassDetail, summary="Отклонить")
async def reject_pass(
    session: SessionDep, user: GuardUser, pass_id: int, data: PassReject
) -> PassDetail:
    item = await service.get_pass_for_user(session, user, pass_id)
    await service.reject_pass(session, user, item, data.reason)
    await session.commit()
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, pass_id))


@router.post("/{pass_id}/cancel", response_model=PassDetail, summary="Отменить")
async def cancel_pass(session: SessionDep, user: CurrentUser, pass_id: int) -> PassDetail:
    item = await service.get_pass_for_user(session, user, pass_id)
    await service.cancel_pass(session, user, item)
    await session.commit()
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, pass_id))


@router.post(
    "/{pass_id}/visits",
    response_model=PassDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Отметить проход/въезд",
)
async def register_visit(
    session: SessionDep, user: GuardUser, pass_id: int, data: VisitCreate
) -> PassDetail:
    item = await service.get_pass_for_user(session, user, pass_id)
    await service.register_visit(session, user, item, data.note)
    await session.commit()
    return PassDetail.model_validate(await service.get_pass_for_user(session, user, pass_id))
