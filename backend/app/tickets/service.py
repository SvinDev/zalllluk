from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload, with_loader_criteria

from app.core.errors import BusinessRuleError, NotFoundError, PermissionDeniedError
from app.housing.service import get_apartment_for_user, get_building, resident_apartment_ids
from app.tickets.models import (
    OPEN_STATUSES,
    TICKET_SLA,
    Ticket,
    TicketComment,
    TicketStatus,
)
from app.tickets.schemas import CommentCreate, Rating, StatusChange, TicketCreate, TicketUpdate
from app.users.models import STAFF_ROLES, User, UserRole

_S = TicketStatus

# Допустимые переходы статусов для сотрудников УК.
STAFF_TRANSITIONS: dict[TicketStatus, frozenset[TicketStatus]] = {
    _S.NEW: frozenset({_S.IN_PROGRESS, _S.WAITING, _S.RESOLVED, _S.REJECTED, _S.CLOSED}),
    _S.IN_PROGRESS: frozenset({_S.WAITING, _S.RESOLVED, _S.REJECTED}),
    _S.WAITING: frozenset({_S.IN_PROGRESS, _S.RESOLVED, _S.REJECTED}),
    _S.RESOLVED: frozenset({_S.CLOSED, _S.IN_PROGRESS}),
    _S.CLOSED: frozenset(),
    _S.REJECTED: frozenset(),
}

# Житель может отозвать новую заявку, подтвердить выполнение или вернуть её в работу.
RESIDENT_TRANSITIONS: dict[TicketStatus, frozenset[TicketStatus]] = {
    _S.NEW: frozenset({_S.CLOSED}),
    _S.RESOLVED: frozenset({_S.CLOSED, _S.IN_PROGRESS}),
}

STATUS_LABELS = {
    _S.NEW: "Новая",
    _S.IN_PROGRESS: "В работе",
    _S.WAITING: "Ожидает",
    _S.RESOLVED: "Выполнена",
    _S.CLOSED: "Закрыта",
    _S.REJECTED: "Отклонена",
}

_TICKET_OPTIONS = (
    joinedload(Ticket.building),
    joinedload(Ticket.apartment),
    joinedload(Ticket.author),
    joinedload(Ticket.assignee),
)


def tickets_query(
    user: User,
    apartment_ids: list[int] | None,
    *,
    statuses: list[TicketStatus] | None = None,
    category: str | None = None,
    priority: str | None = None,
    building_id: int | None = None,
    assignee_id: int | None = None,
    only_open: bool = False,
    overdue: bool = False,
    search: str | None = None,
) -> Select[Any]:
    stmt = select(Ticket).options(*_TICKET_OPTIONS).order_by(Ticket.created_at.desc())
    if apartment_ids is not None:
        # Житель видит заявки по своим помещениям и созданные им самим.
        stmt = stmt.where(or_(Ticket.apartment_id.in_(apartment_ids), Ticket.author_id == user.id))
    if statuses:
        stmt = stmt.where(Ticket.status.in_(statuses))
    if only_open:
        stmt = stmt.where(Ticket.status.in_(OPEN_STATUSES))
    if overdue:
        stmt = stmt.where(Ticket.status.in_(OPEN_STATUSES), Ticket.due_at < datetime.now(UTC))
    if category is not None:
        stmt = stmt.where(Ticket.category == category)
    if priority is not None:
        stmt = stmt.where(Ticket.priority == priority)
    if building_id is not None:
        stmt = stmt.where(Ticket.building_id == building_id)
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(Ticket.subject.ilike(pattern), Ticket.description.ilike(pattern)))
    return stmt


async def get_ticket_for_user(session: AsyncSession, user: User, ticket_id: int) -> Ticket:
    options: list[Any] = [
        *_TICKET_OPTIONS,
        selectinload(Ticket.comments).joinedload(TicketComment.author),
    ]
    if not user.is_staff:
        options.append(with_loader_criteria(TicketComment, TicketComment.is_internal.is_(False)))
    ticket = await session.get(Ticket, ticket_id, options=options, populate_existing=True)
    if ticket is None:
        raise NotFoundError("Заявка не найдена")
    ids = await resident_apartment_ids(session, user)
    if ids is not None and ticket.apartment_id not in ids and ticket.author_id != user.id:
        raise NotFoundError("Заявка не найдена")
    return ticket


def _status_text(previous: TicketStatus, current: TicketStatus) -> str:
    return f"Статус: {STATUS_LABELS[previous]} → {STATUS_LABELS[current]}"


def _add_system_comment(ticket: Ticket, actor: User, text: str) -> None:
    ticket.comments.append(TicketComment(author_id=actor.id, body=text, is_system=True))


async def create_ticket(session: AsyncSession, user: User, data: TicketCreate) -> Ticket:
    if data.apartment_id is not None:
        apartment = await get_apartment_for_user(session, user, data.apartment_id)
        building_id = apartment.building_id
    elif user.is_staff and data.building_id is not None:
        building_id = (await get_building(session, data.building_id)).id
    elif user.is_staff:
        raise BusinessRuleError("Укажите помещение или дом")
    else:
        raise BusinessRuleError("Укажите помещение, к которому относится заявка")

    now = datetime.now(UTC)
    ticket = Ticket(
        building_id=building_id,
        apartment_id=data.apartment_id,
        author_id=user.id,
        category=data.category,
        priority=data.priority,
        subject=data.subject,
        description=data.description,
        status=TicketStatus.NEW,
        due_at=now + TICKET_SLA[data.priority],
        comments=[],
    )
    session.add(ticket)
    await session.flush()
    return ticket


async def _ensure_assignable(session: AsyncSession, user_id: int) -> User:
    assignee = await session.get(User, user_id)
    if assignee is None or not assignee.is_active or assignee.role not in STAFF_ROLES:
        raise BusinessRuleError("Исполнителем может быть только активный сотрудник УК")
    return assignee


async def update_ticket(
    session: AsyncSession, actor: User, ticket: Ticket, data: TicketUpdate
) -> Ticket:
    changes = data.model_dump(exclude_unset=True)
    if "assignee_id" in changes and changes["assignee_id"] != ticket.assignee_id:
        if changes["assignee_id"] is None:
            _add_system_comment(ticket, actor, "Исполнитель снят")
        else:
            assignee = await _ensure_assignable(session, changes["assignee_id"])
            _add_system_comment(ticket, actor, f"Назначен исполнитель: {assignee.full_name}")
            if ticket.status == TicketStatus.NEW:
                ticket.status = TicketStatus.IN_PROGRESS
                _add_system_comment(ticket, actor, _status_text(TicketStatus.NEW, ticket.status))
    if "priority" in changes and changes["priority"] != ticket.priority:
        # Срок пересчитывается от момента создания заявки.
        ticket.due_at = ticket.created_at + TICKET_SLA[changes["priority"]]
    for field, value in changes.items():
        setattr(ticket, field, value)
    await session.flush()
    return ticket


async def change_status(
    session: AsyncSession, actor: User, ticket: Ticket, data: StatusChange
) -> Ticket:
    transitions = STAFF_TRANSITIONS if actor.is_staff else RESIDENT_TRANSITIONS
    if data.status not in transitions.get(ticket.status, frozenset()):
        if not actor.is_staff and data.status in STAFF_TRANSITIONS[ticket.status]:
            raise PermissionDeniedError("Этот статус может установить только сотрудник УК")
        raise BusinessRuleError(
            f"Нельзя перевести заявку из «{STATUS_LABELS[ticket.status]}» "
            f"в «{STATUS_LABELS[data.status]}»"
        )
    if data.status == TicketStatus.REJECTED and not data.comment:
        raise BusinessRuleError("Укажите причину отклонения")

    now = datetime.now(UTC)
    previous = ticket.status
    ticket.status = data.status
    if data.status == TicketStatus.RESOLVED:
        ticket.resolved_at = now
    elif data.status == TicketStatus.IN_PROGRESS and previous == TicketStatus.RESOLVED:
        ticket.resolved_at = None
    if data.status in (TicketStatus.CLOSED, TicketStatus.REJECTED):
        ticket.closed_at = now

    text = _status_text(previous, data.status)
    if data.comment:
        text = f"{text}. {data.comment}"
    _add_system_comment(ticket, actor, text)
    await session.flush()
    return ticket


async def add_comment(
    session: AsyncSession, actor: User, ticket: Ticket, data: CommentCreate
) -> TicketComment:
    if ticket.status in (TicketStatus.CLOSED, TicketStatus.REJECTED):
        raise BusinessRuleError("Заявка закрыта — комментарии недоступны")
    is_internal = data.is_internal and actor.is_staff
    comment = TicketComment(author_id=actor.id, body=data.body, is_internal=is_internal)
    ticket.comments.append(comment)
    # Ответ жителя на заявку «Ожидает» возвращает её в работу.
    if not actor.is_staff and ticket.status == TicketStatus.WAITING:
        ticket.status = TicketStatus.IN_PROGRESS
        _add_system_comment(ticket, actor, "Житель ответил — заявка возвращена в работу")
    await session.flush()
    return comment


async def rate_ticket(session: AsyncSession, actor: User, ticket: Ticket, data: Rating) -> Ticket:
    if actor.role != UserRole.RESIDENT:
        raise PermissionDeniedError("Оценку ставит житель")
    if ticket.status not in (TicketStatus.RESOLVED, TicketStatus.CLOSED):
        raise BusinessRuleError("Оценить можно только выполненную заявку")
    if ticket.rating is not None:
        raise BusinessRuleError("Заявка уже оценена")
    ticket.rating = data.rating
    ticket.rating_comment = data.comment
    if ticket.status == TicketStatus.RESOLVED:
        ticket.status = TicketStatus.CLOSED
        ticket.closed_at = datetime.now(UTC)
        _add_system_comment(ticket, actor, "Житель подтвердил выполнение")
    await session.flush()
    return ticket
