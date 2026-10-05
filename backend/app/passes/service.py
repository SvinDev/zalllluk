import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.config import get_settings
from app.core.errors import BusinessRuleError, NotFoundError, PermissionDeniedError
from app.housing.models import Apartment
from app.housing.service import get_apartment_for_user, resident_apartment_ids
from app.passes.models import Pass, PassKind, PassStatus, PassVisit
from app.passes.plates import is_valid_plate, normalize_plate
from app.passes.schemas import PassCheckResult, PassCreate, PassDetail
from app.users.models import User

# Без похожих символов (0/O, 1/I/L), чтобы код легко продиктовать охране.
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_LENGTH = 6

DEFAULT_DURATION = timedelta(hours=24)
MAX_DURATION = timedelta(days=366)
# Разовый пропуск до суток согласуется автоматически, остальные — сотрудником УК.
AUTO_APPROVE_LIMIT = timedelta(hours=24)

_OPTIONS = (
    joinedload(Pass.apartment).joinedload(Apartment.building),
    joinedload(Pass.created_by),
)


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


async def _unique_code(session: AsyncSession) -> str:
    for _ in range(10):
        code = _generate_code()
        if await session.scalar(select(Pass.id).where(Pass.code == code)) is None:
            return code
    raise RuntimeError("Не удалось сгенерировать уникальный код пропуска")


def passes_query(
    apartment_ids: list[int] | None,
    *,
    status: PassStatus | None = None,
    kind: PassKind | None = None,
    building_id: int | None = None,
    apartment_id: int | None = None,
    active_now: bool = False,
    search: str | None = None,
) -> Select[Any]:
    stmt = (
        select(Pass)
        .join(Pass.apartment)
        .options(*_OPTIONS)
        .order_by(Pass.valid_from.desc(), Pass.id.desc())
    )
    if apartment_ids is not None:
        stmt = stmt.where(Pass.apartment_id.in_(apartment_ids))
    if status is not None:
        stmt = stmt.where(Pass.status == status)
    if kind is not None:
        stmt = stmt.where(Pass.kind == kind)
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    if apartment_id is not None:
        stmt = stmt.where(Pass.apartment_id == apartment_id)
    if active_now:
        now = datetime.now(UTC)
        stmt = stmt.where(
            Pass.status == PassStatus.ACTIVE, Pass.valid_from <= now, Pass.valid_until > now
        )
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Pass.code == search.strip().upper(),
                Pass.visitor_name.ilike(pattern),
                Pass.vehicle_plate.ilike(f"%{normalize_plate(search)}%"),
            )
        )
    return stmt


async def get_pass_for_user(session: AsyncSession, user: User, pass_id: int) -> Pass:
    item = await session.get(
        Pass,
        pass_id,
        options=[*_OPTIONS, selectinload(Pass.visits).joinedload(PassVisit.checked_by)],
        populate_existing=True,
    )
    if item is None:
        raise NotFoundError("Пропуск не найден")
    ids = await resident_apartment_ids(session, user)
    if ids is not None and item.apartment_id not in ids:
        raise NotFoundError("Пропуск не найден")
    return item


async def create_pass(session: AsyncSession, user: User, data: PassCreate) -> Pass:
    await get_apartment_for_user(session, user, data.apartment_id)
    now = datetime.now(UTC)
    valid_from = data.valid_from or now
    valid_until = data.valid_until or valid_from + DEFAULT_DURATION
    if valid_until <= valid_from:
        raise BusinessRuleError("Окончание действия должно быть позже начала")
    if valid_until <= now:
        raise BusinessRuleError("Срок действия пропуска уже истёк")
    if valid_until - valid_from > MAX_DURATION:
        raise BusinessRuleError("Пропуск выдаётся не более чем на год")

    plate = None
    if data.vehicle_plate:
        plate = normalize_plate(data.vehicle_plate)
        if not is_valid_plate(plate):
            raise BusinessRuleError("Некорректный госномер")

    auto_approved = user.is_staff or (
        data.is_one_time and valid_until - valid_from <= AUTO_APPROVE_LIMIT
    )
    item = Pass(
        code=await _unique_code(session),
        apartment_id=data.apartment_id,
        created_by_id=user.id,
        kind=data.kind,
        visitor_name=data.visitor_name,
        vehicle_plate=plate,
        comment=data.comment,
        valid_from=valid_from,
        valid_until=valid_until,
        is_one_time=data.is_one_time,
        status=PassStatus.ACTIVE if auto_approved else PassStatus.PENDING,
    )
    if user.is_staff:
        item.reviewed_by_id, item.reviewed_at = user.id, now
    session.add(item)
    await session.flush()
    return item


async def approve_pass(session: AsyncSession, actor: User, item: Pass) -> Pass:
    if item.status != PassStatus.PENDING:
        raise BusinessRuleError("Согласовать можно только пропуск, ожидающий согласования")
    item.status = PassStatus.ACTIVE
    item.reviewed_by_id, item.reviewed_at = actor.id, datetime.now(UTC)
    await session.flush()
    return item


async def reject_pass(session: AsyncSession, actor: User, item: Pass, reason: str) -> Pass:
    if item.status != PassStatus.PENDING:
        raise BusinessRuleError("Отклонить можно только пропуск, ожидающий согласования")
    item.status = PassStatus.REJECTED
    item.reject_reason = reason
    item.reviewed_by_id, item.reviewed_at = actor.id, datetime.now(UTC)
    await session.flush()
    return item


async def cancel_pass(session: AsyncSession, actor: User, item: Pass) -> Pass:
    if item.status not in (PassStatus.PENDING, PassStatus.ACTIVE):
        raise BusinessRuleError("Пропуск уже недействителен")
    if not actor.is_staff and item.created_by_id != actor.id:
        # Пропуск, выданный УК (например, постоянный для автомобиля), житель не отменяет.
        raise PermissionDeniedError("Отменить можно только свой пропуск")
    item.status = PassStatus.CANCELLED
    await session.flush()
    return item


def _invalid_reason(item: Pass, now: datetime) -> str | None:
    if item.status == PassStatus.PENDING:
        return "Пропуск ещё не согласован УК"
    if item.status == PassStatus.REJECTED:
        return "Пропуск отклонён"
    if item.status == PassStatus.CANCELLED:
        return "Пропуск отменён"
    if item.status == PassStatus.USED:
        return "Разовый пропуск уже использован"
    if now < item.valid_from:
        local = item.valid_from.astimezone(get_settings().tz)
        return f"Пропуск действует с {local:%d.%m.%Y %H:%M}"
    if now >= item.valid_until:
        return "Срок действия пропуска истёк"
    return None


async def check_passes(
    session: AsyncSession, *, code: str | None, plate: str | None
) -> list[PassCheckResult]:
    """Поиск для поста охраны: по коду или госномеру, свежие пропуска первыми."""
    if not code and not plate:
        raise BusinessRuleError("Укажите код пропуска или госномер")
    stmt = select(Pass).options(
        *_OPTIONS, selectinload(Pass.visits).joinedload(PassVisit.checked_by)
    )
    if code:
        stmt = stmt.where(Pass.code == code.strip().upper())
    if plate:
        stmt = stmt.where(Pass.vehicle_plate == normalize_plate(plate))
    since = datetime.now(UTC) - timedelta(days=30)
    stmt = stmt.where(Pass.valid_until > since).order_by(Pass.valid_from.desc()).limit(20)

    now = datetime.now(UTC)
    results = []
    for item in await session.scalars(stmt):
        reason = _invalid_reason(item, now)
        detail = PassDetail.model_validate(item).model_dump()
        results.append(PassCheckResult(**detail, valid_now=reason is None, reason=reason))
    return results


async def register_visit(
    session: AsyncSession, actor: User, item: Pass, note: str | None
) -> PassVisit:
    reason = _invalid_reason(item, datetime.now(UTC))
    if reason is not None:
        raise BusinessRuleError(reason)
    visit = PassVisit(pass_id=item.id, checked_by_id=actor.id, note=note)
    session.add(visit)
    if item.is_one_time:
        item.status = PassStatus.USED
    await session.flush()
    return visit
