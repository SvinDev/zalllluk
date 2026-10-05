from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.errors import AppError, BusinessRuleError, ConflictError, NotFoundError
from app.housing.models import Apartment, Building
from app.housing.service import resident_apartment_ids, restrict_to_apartments
from app.meters.models import Meter, MeterKind, MeterReading, ReadingSource
from app.meters.schemas import (
    ExternalReading,
    IngestError,
    IngestReport,
    MeterCreate,
    MeterUpdate,
)
from app.users.models import User

# Допуск на расхождение часов у внешних устройств.
_FUTURE_TOLERANCE = timedelta(minutes=5)

_METER_OPTIONS = (joinedload(Meter.apartment).joinedload(Apartment.building),)


# ---------- Приборы учёта ----------


async def get_meter_for_user(session: AsyncSession, user: User, meter_id: int) -> Meter:
    meter = await session.get(Meter, meter_id, options=_METER_OPTIONS, populate_existing=True)
    if meter is None:
        raise NotFoundError("Счётчик не найден")
    ids = await resident_apartment_ids(session, user)
    if ids is not None and meter.apartment_id not in ids:
        raise NotFoundError("Счётчик не найден")
    return meter


def meters_query(
    apartment_ids: list[int] | None,
    *,
    apartment_id: int | None = None,
    building_id: int | None = None,
    kind: MeterKind | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    verification_due_before: date | None = None,
    no_reading_since: date | None = None,
) -> Select[Any]:
    stmt = (
        select(Meter)
        .join(Meter.apartment)
        .join(Apartment.building)
        .options(*_METER_OPTIONS)
        .order_by(Building.address, func.length(Apartment.number), Apartment.number, Meter.kind)
    )
    stmt = restrict_to_apartments(stmt, Meter.apartment_id, apartment_ids)
    if apartment_id is not None:
        stmt = stmt.where(Meter.apartment_id == apartment_id)
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    if kind is not None:
        stmt = stmt.where(Meter.kind == kind)
    if is_active is not None:
        stmt = stmt.where(Meter.is_active.is_(is_active))
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Meter.serial_number.ilike(pattern),
                Meter.external_id.ilike(pattern),
                Apartment.account_number.ilike(pattern),
            )
        )
    if verification_due_before is not None:
        stmt = stmt.where(Meter.verification_due <= verification_due_before)
    if no_reading_since is not None:
        since = datetime.combine(no_reading_since, time.min, tzinfo=UTC)
        stmt = stmt.where(
            ~exists().where(MeterReading.meter_id == Meter.id, MeterReading.taken_at >= since)
        )
    return stmt


async def last_readings(session: AsyncSession, meter_ids: Sequence[int]) -> dict[int, MeterReading]:
    if not meter_ids:
        return {}
    rows = await session.scalars(
        select(MeterReading)
        .ext(distinct_on(MeterReading.meter_id))
        .where(MeterReading.meter_id.in_(meter_ids))
        .order_by(MeterReading.meter_id, MeterReading.taken_at.desc())
    )
    return {reading.meter_id: reading for reading in rows}


async def _ensure_meter_unique(
    session: AsyncSession,
    *,
    serial_number: str | None,
    external_id: str | None,
    exclude_id: int | None = None,
) -> None:
    checks = [
        (Meter.serial_number, serial_number, "Счётчик с серийным номером {} уже зарегистрирован"),
        (Meter.external_id, external_id, "Внешний ID {} уже привязан к другому счётчику"),
    ]
    for column, value, message in checks:
        if value is None:
            continue
        stmt = select(Meter.id).where(column == value)
        if exclude_id is not None:
            stmt = stmt.where(Meter.id != exclude_id)
        if await session.scalar(stmt) is not None:
            raise ConflictError(message.format(value))


async def create_meter(session: AsyncSession, data: MeterCreate) -> Meter:
    if await session.get(Apartment, data.apartment_id) is None:
        raise NotFoundError("Помещение не найдено")
    await _ensure_meter_unique(
        session, serial_number=data.serial_number, external_id=data.external_id
    )
    meter = Meter(**data.model_dump())
    session.add(meter)
    await session.flush()
    return meter


async def update_meter(session: AsyncSession, meter: Meter, data: MeterUpdate) -> Meter:
    changes = data.model_dump(exclude_unset=True)
    await _ensure_meter_unique(
        session,
        serial_number=changes.get("serial_number"),
        external_id=changes.get("external_id"),
        exclude_id=meter.id,
    )
    for field, value in changes.items():
        setattr(meter, field, value)
    await session.flush()
    return meter


async def delete_meter(session: AsyncSession, meter: Meter) -> None:
    has_readings = await session.scalar(select(exists().where(MeterReading.meter_id == meter.id)))
    if has_readings:
        raise ConflictError(
            "У счётчика есть показания — удалить нельзя, выведите его из эксплуатации"
        )
    await session.delete(meter)
    await session.flush()


# ---------- Показания ----------


async def add_reading(
    session: AsyncSession,
    meter: Meter,
    *,
    value: Decimal,
    taken_at: datetime | None,
    source: ReadingSource,
    submitted_by: User | None = None,
) -> MeterReading:
    """Добавляет показание, проверяя монотонность относительно соседних показаний."""
    # Блокировка строки счётчика сериализует параллельные приёмы показаний по нему.
    await session.execute(select(Meter.id).where(Meter.id == meter.id).with_for_update())

    now = datetime.now(UTC)
    taken_at = taken_at or now
    if not meter.is_active:
        raise BusinessRuleError("Счётчик выведен из эксплуатации")
    if taken_at > now + _FUTURE_TOLERANCE:
        raise BusinessRuleError("Дата показаний не может быть в будущем")
    if meter.installed_at and taken_at.date() < meter.installed_at:
        raise BusinessRuleError("Дата показаний раньше даты установки счётчика")

    duplicate = await session.scalar(
        select(MeterReading.id).where(
            MeterReading.meter_id == meter.id, MeterReading.taken_at == taken_at
        )
    )
    if duplicate is not None:
        raise ConflictError("Показание на этот момент времени уже есть")

    previous = await session.scalar(
        select(MeterReading.value)
        .where(MeterReading.meter_id == meter.id, MeterReading.taken_at < taken_at)
        .order_by(MeterReading.taken_at.desc())
        .limit(1)
    )
    floor = previous if previous is not None else meter.initial_value
    if value < floor:
        raise BusinessRuleError(f"Показание {value} меньше предыдущего ({floor})")

    following = await session.scalar(
        select(MeterReading.value)
        .where(MeterReading.meter_id == meter.id, MeterReading.taken_at > taken_at)
        .order_by(MeterReading.taken_at)
        .limit(1)
    )
    if following is not None and value > following:
        raise BusinessRuleError(f"Показание {value} больше последующего ({following})")

    reading = MeterReading(
        meter_id=meter.id,
        value=value,
        taken_at=taken_at,
        source=source,
        submitted_by_id=submitted_by.id if submitted_by else None,
    )
    session.add(reading)
    await session.flush()
    return reading


def _consumption_column() -> Any:
    previous = func.lag(MeterReading.value).over(
        partition_by=MeterReading.meter_id, order_by=MeterReading.taken_at
    )
    return (MeterReading.value - func.coalesce(previous, Meter.initial_value)).label("consumption")


def readings_query(meter_id: int) -> Select[Any]:
    """Показания счётчика (новые сверху) с расходом относительно предыдущего."""
    return (
        select(MeterReading, _consumption_column())
        .join(Meter, Meter.id == MeterReading.meter_id)
        .where(MeterReading.meter_id == meter_id)
        .order_by(MeterReading.taken_at.desc())
    )


def journal_query(
    *,
    building_id: int | None = None,
    kind: MeterKind | None = None,
    source: ReadingSource | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Select[Any]:
    """Журнал показаний по всем счётчикам.

    Расход считается оконной функцией во вложенном запросе — до фильтра по датам,
    иначе первое показание в выбранном периоде потеряет предыдущее значение.
    """
    inner = select(MeterReading.id.label("reading_id"), _consumption_column()).join(
        Meter, Meter.id == MeterReading.meter_id
    )
    if building_id is not None or kind is not None:
        inner = inner.join(Apartment, Apartment.id == Meter.apartment_id)
        if building_id is not None:
            inner = inner.where(Apartment.building_id == building_id)
        if kind is not None:
            inner = inner.where(Meter.kind == kind)
    sub = inner.subquery()

    stmt = (
        select(MeterReading, sub.c.consumption)
        .join(sub, sub.c.reading_id == MeterReading.id)
        .options(
            joinedload(MeterReading.meter)
            .joinedload(Meter.apartment)
            .joinedload(Apartment.building)
        )
        .order_by(MeterReading.taken_at.desc(), MeterReading.id.desc())
    )
    if source is not None:
        stmt = stmt.where(MeterReading.source == source)
    if date_from is not None:
        stmt = stmt.where(MeterReading.taken_at >= datetime.combine(date_from, time.min, UTC))
    if date_to is not None:
        end = datetime.combine(date_to + timedelta(days=1), time.min, UTC)
        stmt = stmt.where(MeterReading.taken_at < end)
    return stmt


async def get_reading(session: AsyncSession, reading_id: int) -> MeterReading:
    reading = await session.get(MeterReading, reading_id)
    if reading is None:
        raise NotFoundError("Показание не найдено")
    return reading


# ---------- Приём показаний из внешних систем ----------


async def ingest_external_readings(
    session: AsyncSession, items: Sequence[ExternalReading], source: ReadingSource
) -> IngestReport:
    """Пакетный приём показаний. Ошибка в одной записи не роняет весь пакет.

    Повторная отправка того же показания (тот же прибор, момент и значение)
    считается дублем и не является ошибкой — внешние системы любят ретраи.
    """
    serials = {i.serial_number for i in items if i.serial_number}
    external_ids = {i.external_id for i in items if i.external_id}
    meters = list(
        await session.scalars(
            select(Meter).where(
                or_(Meter.serial_number.in_(serials), Meter.external_id.in_(external_ids))
            )
        )
    )
    by_serial = {m.serial_number: m for m in meters}
    by_external = {m.external_id: m for m in meters if m.external_id}

    accepted = duplicates = 0
    rejected: list[IngestError] = []

    def reject(index: int, item: ExternalReading, error: str) -> None:
        rejected.append(
            IngestError(
                index=index,
                serial_number=item.serial_number,
                external_id=item.external_id,
                error=error,
            )
        )

    # Хронологический порядок важен для проверки монотонности внутри пакета.
    ordered = sorted(enumerate(items), key=lambda pair: pair[1].taken_at)
    for index, item in ordered:
        meter = (by_external.get(item.external_id) if item.external_id else None) or (
            by_serial.get(item.serial_number) if item.serial_number else None
        )
        if meter is None:
            reject(index, item, "Счётчик не найден")
            continue
        existing = await session.scalar(
            select(MeterReading.value).where(
                and_(MeterReading.meter_id == meter.id, MeterReading.taken_at == item.taken_at)
            )
        )
        if existing is not None:
            if existing == item.value:
                duplicates += 1
            else:
                reject(index, item, f"На этот момент уже записано другое значение ({existing})")
            continue
        try:
            async with session.begin_nested():
                await add_reading(
                    session, meter, value=item.value, taken_at=item.taken_at, source=source
                )
        except AppError as exc:
            reject(index, item, exc.message)
            continue
        accepted += 1

    rejected.sort(key=lambda error: error.index)
    return IngestReport(
        received=len(items), accepted=accepted, duplicates=duplicates, rejected=rejected
    )
