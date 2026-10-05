from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.auth.deps import CurrentUser, ManagerUser, SessionDep
from app.core.pagination import Page, PageParams, page_params, paginate
from app.housing.service import resident_apartment_ids
from app.tickets import service
from app.tickets.models import TicketCategory, TicketPriority, TicketStatus
from app.tickets.schemas import (
    CommentCreate,
    Rating,
    StatusChange,
    TicketCreate,
    TicketDetail,
    TicketRead,
    TicketUpdate,
)

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("", response_model=Page[TicketRead], summary="Заявки и обращения")
async def list_tickets(
    session: SessionDep,
    user: CurrentUser,
    page: Annotated[PageParams, Depends(page_params)],
    ticket_status: Annotated[list[TicketStatus] | None, Query(alias="status")] = None,
    category: TicketCategory | None = None,
    priority: TicketPriority | None = None,
    building_id: int | None = None,
    apartment_id: int | None = None,
    assignee_id: int | None = None,
    only_open: bool = False,
    overdue: bool = False,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[TicketRead]:
    ids = await resident_apartment_ids(session, user)
    stmt = service.tickets_query(
        user,
        ids,
        statuses=ticket_status,
        category=category,
        priority=priority,
        building_id=building_id,
        apartment_id=apartment_id,
        assignee_id=assignee_id,
        only_open=only_open,
        overdue=overdue,
        search=search,
    )
    tickets, total = await paginate(session, stmt, page)
    return Page(
        items=[TicketRead.model_validate(t) for t in tickets],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "",
    response_model=TicketDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Создать заявку",
)
async def create_ticket(session: SessionDep, user: CurrentUser, data: TicketCreate) -> TicketDetail:
    ticket = await service.create_ticket(session, user, data)
    await session.commit()
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket.id))


@router.get("/{ticket_id}", response_model=TicketDetail, summary="Заявка")
async def get_ticket(session: SessionDep, user: CurrentUser, ticket_id: int) -> TicketDetail:
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket_id))


@router.patch(
    "/{ticket_id}",
    response_model=TicketDetail,
    summary="Изменить заявку: категория, приоритет, исполнитель",
)
async def update_ticket(
    session: SessionDep, user: ManagerUser, ticket_id: int, data: TicketUpdate
) -> TicketDetail:
    ticket = await service.get_ticket_for_user(session, user, ticket_id)
    await service.update_ticket(session, user, ticket, data)
    await session.commit()
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket_id))


@router.post("/{ticket_id}/status", response_model=TicketDetail, summary="Сменить статус")
async def change_status(
    session: SessionDep, user: CurrentUser, ticket_id: int, data: StatusChange
) -> TicketDetail:
    ticket = await service.get_ticket_for_user(session, user, ticket_id)
    await service.change_status(session, user, ticket, data)
    await session.commit()
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket_id))


@router.post(
    "/{ticket_id}/comments",
    response_model=TicketDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить комментарий",
)
async def add_comment(
    session: SessionDep, user: CurrentUser, ticket_id: int, data: CommentCreate
) -> TicketDetail:
    ticket = await service.get_ticket_for_user(session, user, ticket_id)
    await service.add_comment(session, user, ticket, data)
    await session.commit()
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket_id))


@router.post("/{ticket_id}/rate", response_model=TicketDetail, summary="Оценить выполнение")
async def rate_ticket(
    session: SessionDep, user: CurrentUser, ticket_id: int, data: Rating
) -> TicketDetail:
    ticket = await service.get_ticket_for_user(session, user, ticket_id)
    await service.rate_ticket(session, user, ticket, data)
    await session.commit()
    return TicketDetail.model_validate(await service.get_ticket_for_user(session, user, ticket_id))
