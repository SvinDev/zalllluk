from typing import Any

from sqlalchemy import Select, delete, exists, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, joinedload, selectinload

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.housing.models import Apartment, Building, apartment_residents
from app.housing.schemas import ApartmentCreate, ApartmentUpdate, BuildingCreate, BuildingUpdate
from app.users.models import User, UserRole

# ---------- Доступ жителей ----------


async def resident_apartment_ids(session: AsyncSession, user: User) -> list[int] | None:
    """ID помещений, доступных пользователю. None — доступ ко всем (сотрудник УК)."""
    if user.is_staff:
        return None
    rows = await session.scalars(
        select(apartment_residents.c.apartment_id).where(apartment_residents.c.user_id == user.id)
    )
    return list(rows)


def restrict_to_apartments(
    stmt: Select[Any], column: InstrumentedAttribute[int], ids: list[int] | None
) -> Select[Any]:
    """Ограничивает выборку помещениями пользователя (для жителей)."""
    if ids is None:
        return stmt
    return stmt.where(column.in_(ids))


async def get_apartment_for_user(
    session: AsyncSession, user: User, apartment_id: int, *, with_residents: bool = False
) -> Apartment:
    """Помещение с проверкой доступа. Чужое помещение для жителя — 404, а не 403."""
    options = [joinedload(Apartment.building)]
    if with_residents:
        options.append(selectinload(Apartment.residents))
    # populate_existing: объект мог уже быть в identity map без нужных связей.
    apartment = await session.get(Apartment, apartment_id, options=options, populate_existing=True)
    if apartment is None:
        raise NotFoundError("Помещение не найдено")
    ids = await resident_apartment_ids(session, user)
    if ids is not None and apartment.id not in ids:
        raise NotFoundError("Помещение не найдено")
    return apartment


# ---------- Дома ----------


def buildings_query(apartment_ids: list[int] | None, search: str | None) -> Select[Any]:
    apartments_count = (
        select(func.count(Apartment.id))
        .where(Apartment.building_id == Building.id)
        .correlate(Building)
        .scalar_subquery()
        .label("apartments_count")
    )
    stmt = select(Building, apartments_count).order_by(Building.address)
    if apartment_ids is not None:
        stmt = stmt.where(
            Building.id.in_(select(Apartment.building_id).where(Apartment.id.in_(apartment_ids)))
        )
    if search:
        stmt = stmt.where(Building.address.ilike(f"%{search.strip()}%"))
    return stmt


async def get_building_with_count(
    session: AsyncSession, user: User, building_id: int
) -> tuple[Building, int]:
    ids = await resident_apartment_ids(session, user)
    row = (
        await session.execute(buildings_query(ids, None).where(Building.id == building_id))
    ).first()
    if row is None:
        raise NotFoundError("Дом не найден")
    return row[0], row[1]


async def get_building(session: AsyncSession, building_id: int) -> Building:
    building = await session.get(Building, building_id)
    if building is None:
        raise NotFoundError("Дом не найден")
    return building


async def _ensure_address_free(
    session: AsyncSession, address: str, exclude_id: int | None = None
) -> None:
    stmt = select(Building.id).where(func.lower(Building.address) == address.strip().lower())
    if exclude_id is not None:
        stmt = stmt.where(Building.id != exclude_id)
    if await session.scalar(stmt) is not None:
        raise ConflictError("Дом с таким адресом уже есть")


async def create_building(session: AsyncSession, data: BuildingCreate) -> Building:
    await _ensure_address_free(session, data.address)
    building = Building(**data.model_dump())
    session.add(building)
    await session.flush()
    return building


async def update_building(
    session: AsyncSession, building: Building, data: BuildingUpdate
) -> Building:
    changes = data.model_dump(exclude_unset=True)
    if changes.get("address"):
        await _ensure_address_free(session, changes["address"], exclude_id=building.id)
    for field, value in changes.items():
        setattr(building, field, value)
    await session.flush()
    return building


async def delete_building(session: AsyncSession, building: Building) -> None:
    has_apartments = await session.scalar(
        select(exists().where(Apartment.building_id == building.id))
    )
    if has_apartments:
        raise ConflictError("Нельзя удалить дом, в котором есть помещения")
    await session.delete(building)
    await session.flush()


# ---------- Помещения ----------


def apartments_query(
    apartment_ids: list[int] | None, *, building_id: int | None, search: str | None
) -> Select[Any]:
    stmt = (
        select(Apartment)
        .join(Apartment.building)
        .options(joinedload(Apartment.building))
        .order_by(Building.address, func.length(Apartment.number), Apartment.number)
    )
    stmt = restrict_to_apartments(stmt, Apartment.id, apartment_ids)
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Apartment.number.ilike(pattern),
                Apartment.account_number.ilike(pattern),
                Apartment.owner_name.ilike(pattern),
                Building.address.ilike(pattern),
            )
        )
    return stmt


async def _ensure_apartment_unique(
    session: AsyncSession,
    *,
    building_id: int,
    number: str | None,
    account_number: str | None,
    exclude_id: int | None = None,
) -> None:
    def _scoped(stmt: Select[Any]) -> Select[Any]:
        return stmt if exclude_id is None else stmt.where(Apartment.id != exclude_id)

    if number is not None:
        taken = await session.scalar(
            _scoped(
                select(Apartment.id).where(
                    Apartment.building_id == building_id, Apartment.number == number
                )
            )
        )
        if taken is not None:
            raise ConflictError(f"Помещение № {number} в этом доме уже существует")
    if account_number is not None:
        taken = await session.scalar(
            _scoped(select(Apartment.id).where(Apartment.account_number == account_number))
        )
        if taken is not None:
            raise ConflictError(f"Лицевой счёт {account_number} уже занят")


async def create_apartment(session: AsyncSession, data: ApartmentCreate) -> Apartment:
    await get_building(session, data.building_id)
    await _ensure_apartment_unique(
        session,
        building_id=data.building_id,
        number=data.number,
        account_number=data.account_number,
    )
    apartment = Apartment(**data.model_dump())
    session.add(apartment)
    await session.flush()
    return apartment


async def update_apartment(
    session: AsyncSession, apartment: Apartment, data: ApartmentUpdate
) -> Apartment:
    changes = data.model_dump(exclude_unset=True)
    await _ensure_apartment_unique(
        session,
        building_id=apartment.building_id,
        number=changes.get("number"),
        account_number=changes.get("account_number"),
        exclude_id=apartment.id,
    )
    for field, value in changes.items():
        setattr(apartment, field, value)
    await session.flush()
    return apartment


async def add_resident(session: AsyncSession, apartment: Apartment, user_id: int) -> None:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError("Пользователь не найден")
    if user.role != UserRole.RESIDENT:
        raise BusinessRuleError("Привязать к помещению можно только пользователя-жителя")
    linked = await session.scalar(
        select(
            exists().where(
                apartment_residents.c.apartment_id == apartment.id,
                apartment_residents.c.user_id == user_id,
            )
        )
    )
    if not linked:
        await session.execute(
            insert(apartment_residents).values(apartment_id=apartment.id, user_id=user_id)
        )


async def remove_resident(session: AsyncSession, apartment: Apartment, user_id: int) -> None:
    await session.execute(
        delete(apartment_residents).where(
            apartment_residents.c.apartment_id == apartment.id,
            apartment_residents.c.user_id == user_id,
        )
    )


async def user_apartments(session: AsyncSession, user: User) -> list[Apartment]:
    rows = await session.scalars(
        select(Apartment)
        .join(apartment_residents, apartment_residents.c.apartment_id == Apartment.id)
        .where(apartment_residents.c.user_id == user.id)
        .options(joinedload(Apartment.building))
        .order_by(Apartment.id)
    )
    return list(rows)
