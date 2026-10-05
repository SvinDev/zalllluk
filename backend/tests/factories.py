"""Минимальные фабрики тестовых данных: создают объекты напрямую через ORM."""

import itertools
from datetime import datetime
from decimal import Decimal

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.housing.models import Apartment, Building, apartment_residents
from app.meters.models import Meter, MeterKind, MeterReading, ReadingSource
from app.users.models import User, UserRole

PASSWORD = "password123"
# Хэш считаем один раз: argon2 намеренно медленный.
_PASSWORD_HASH = hash_password(PASSWORD)
_seq = itertools.count(1)


def auth(user: User) -> dict[str, str]:
    token, _ = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


async def make_user(
    session: AsyncSession, role: UserRole = UserRole.RESIDENT, **fields: object
) -> User:
    n = next(_seq)
    values: dict[str, object] = {
        "email": f"user{n}@example.com",
        "full_name": f"Пользователь {n}",
        "password_hash": _PASSWORD_HASH,
        **fields,
    }
    user = User(role=role, **values)
    session.add(user)
    await session.flush()
    return user


async def make_building(session: AsyncSession, **fields: object) -> Building:
    n = next(_seq)
    building = Building(**{"address": f"г. Москва, ул. Тестовая, д. {n}", **fields})
    session.add(building)
    await session.flush()
    return building


async def make_apartment(
    session: AsyncSession,
    building: Building | None = None,
    *,
    residents: list[User] | None = None,
    **fields: object,
) -> Apartment:
    building = building or await make_building(session)
    n = next(_seq)
    values: dict[str, object] = {
        "number": str(n),
        "account_number": f"LS{n:08d}",
        "area": Decimal("50.00"),
        "residents_count": 2,
        **fields,
    }
    apartment = Apartment(building_id=building.id, **values)
    session.add(apartment)
    await session.flush()
    for resident in residents or []:
        await session.execute(
            insert(apartment_residents).values(apartment_id=apartment.id, user_id=resident.id)
        )
    return apartment


async def make_meter(
    session: AsyncSession,
    apartment: Apartment | None = None,
    kind: MeterKind = MeterKind.COLD_WATER,
    **fields: object,
) -> Meter:
    apartment = apartment or await make_apartment(session)
    n = next(_seq)
    values: dict[str, object] = {"serial_number": f"SN-{n:06d}", **fields}
    meter = Meter(apartment_id=apartment.id, kind=kind, **values)
    session.add(meter)
    await session.flush()
    return meter


async def make_reading(
    session: AsyncSession,
    meter: Meter,
    value: str | Decimal,
    taken_at: datetime,
    source: ReadingSource = ReadingSource.STAFF,
) -> MeterReading:
    reading = MeterReading(
        meter_id=meter.id, value=Decimal(value), taken_at=taken_at, source=source
    )
    session.add(reading)
    await session.flush()
    return reading
