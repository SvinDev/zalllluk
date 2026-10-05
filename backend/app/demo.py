"""Демонстрационные данные: два дома, жители, счётчики с историей, начисления,
оплаты, заявки и пропуска. Генерация детерминирована (фиксированный seed)."""

import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.announcements.models import Announcement
from app.billing import periods
from app.billing.models import Payment, PaymentMethod, Tariff, TariffMethod
from app.billing.service import account_summary, issue_period, reallocate_payments, run_billing
from app.core.config import get_settings
from app.core.security import hash_password
from app.housing.models import Apartment, Building, apartment_residents
from app.integrations.service import create_api_key
from app.meters.models import Meter, MeterKind, MeterReading, ReadingSource
from app.passes.models import Pass, PassKind, PassStatus
from app.tickets.models import (
    TICKET_SLA,
    Ticket,
    TicketCategory,
    TicketComment,
    TicketPriority,
    TicketStatus,
)
from app.users.models import User, UserRole

DEMO_PASSWORD = "demo12345"

_SURNAMES = [
    "Иванов", "Смирнова", "Кузнецов", "Попова", "Васильев", "Петрова", "Соколов",
    "Михайлова", "Новиков", "Фёдорова", "Морозов", "Волкова", "Алексеев", "Лебедева",
    "Семёнов", "Егорова", "Павлов", "Козлова", "Степанов", "Николаева",
]  # fmt: skip
_INITIALS = ["А. В.", "Е. С.", "Д. И.", "О. Н.", "С. П.", "М. А.", "И. Г.", "Т. В."]

_SERIAL_PREFIX = {
    MeterKind.COLD_WATER: "ХВ",
    MeterKind.HOT_WATER: "ГВ",
    MeterKind.ELECTRICITY: "ЭЛ",
}

# Средний месячный расход на человека — для правдоподобной истории показаний.
_MONTHLY_PER_PERSON = {
    MeterKind.COLD_WATER: Decimal("3.4"),
    MeterKind.HOT_WATER: Decimal("2.6"),
    MeterKind.ELECTRICITY: Decimal("85"),
}


def _tariffs(valid_from: date) -> list[Tariff]:
    def tariff(name: str, method: TariffMethod, rate: str, **extra: object) -> Tariff:
        return Tariff(name=name, method=method, rate=Decimal(rate), valid_from=valid_from, **extra)

    return [
        tariff("Содержание и ремонт жилого помещения", TariffMethod.PER_AREA, "32.80"),
        tariff("Взнос на капитальный ремонт", TariffMethod.PER_AREA, "21.36"),
        tariff("Обращение с ТКО", TariffMethod.PER_RESIDENT, "118.40"),
        tariff(
            "Холодное водоснабжение",
            TariffMethod.METERED,
            "52.82",
            meter_kind=MeterKind.COLD_WATER,
            normative=Decimal("4.9"),
        ),
        tariff(
            "Горячее водоснабжение",
            TariffMethod.METERED,
            "248.51",
            meter_kind=MeterKind.HOT_WATER,
            normative=Decimal("3.6"),
        ),
        tariff(
            "Электроснабжение",
            TariffMethod.METERED,
            "6.43",
            meter_kind=MeterKind.ELECTRICITY,
            normative=Decimal("100"),
        ),
        tariff("Домофон", TariffMethod.FIXED, "65.00"),
    ]


async def seed(session: AsyncSession) -> str:
    rnd = random.Random(42)
    tz = get_settings().tz
    now = datetime.now(UTC)
    current = periods.first_day(now.astimezone(tz).date())
    password_hash = hash_password(DEMO_PASSWORD)

    def user(email: str, name: str, role: UserRole, phone: str | None = None) -> User:
        return User(
            email=email, full_name=name, role=role, phone=phone, password_hash=password_hash
        )

    admin = user("admin@demo.ru", "Администратор УК", UserRole.ADMIN)
    manager = user("manager@demo.ru", "Ольга Диспетчерова", UserRole.MANAGER, "+7 900 100-00-01")
    accountant = user("buh@demo.ru", "Марина Бухгалтерова", UserRole.ACCOUNTANT)
    guard = user("guard@demo.ru", "Пост охраны", UserRole.SECURITY)
    session.add_all([admin, manager, accountant, guard])

    buildings = [
        Building(address="г. Москва, ул. Лесная, д. 12", floors=9, entrances=4, year_built=1987),
        Building(
            address="г. Москва, ул. Садовая, д. 5, к. 2", floors=17, entrances=2, year_built=2015
        ),
    ]
    session.add_all(buildings)
    await session.flush()

    session.add_all(_tariffs(periods.add_months(current, -12)))

    apartments: list[Apartment] = []
    residents: list[User] = []
    for building_index, (building, count) in enumerate(zip(buildings, (12, 8), strict=True)):
        for number in range(1, count + 1):
            owner = f"{rnd.choice(_SURNAMES)} {rnd.choice(_INITIALS)}"
            apartment = Apartment(
                building_id=building.id,
                number=str(number),
                account_number=f"{building_index + 1}{number:05d}",
                area=Decimal(rnd.randrange(3200, 9800)) / 100,
                residents_count=rnd.randint(1, 4),
                owner_name=owner,
            )
            apartments.append(apartment)
    session.add_all(apartments)
    await session.flush()

    # Первая квартира — у демо-жителя, у остальных части квартир тоже есть аккаунты.
    demo_resident = user("resident@demo.ru", "Анна Жителева", UserRole.RESIDENT, "+7 900 200-00-01")
    residents.append(demo_resident)
    for index in range(1, 6):
        residents.append(
            user(f"resident{index}@demo.ru", apartments[index].owner_name or "", UserRole.RESIDENT)
        )
    session.add_all(residents)
    await session.flush()
    for index, resident in enumerate(residents):
        await session.execute(
            insert(apartment_residents).values(
                apartment_id=apartments[index].id, user_id=resident.id
            )
        )

    # Счётчики и показания за 5 месяцев; часть квартир «забывает» передать показания.
    meters: list[Meter] = []
    for apartment in apartments:
        for kind in (MeterKind.COLD_WATER, MeterKind.HOT_WATER, MeterKind.ELECTRICITY):
            meters.append(
                Meter(
                    apartment_id=apartment.id,
                    kind=kind,
                    serial_number=f"{_SERIAL_PREFIX[kind]}-{apartment.account_number}",
                    external_id=(
                        f"iot-{apartment.account_number}-{kind.value}"
                        if kind == MeterKind.ELECTRICITY
                        else None
                    ),
                    installed_at=date(2021, 3, 1),
                    verification_due=date(2027, 3, 1)
                    if rnd.random() > 0.15
                    else (current + timedelta(days=rnd.randint(5, 25))),
                    initial_value=Decimal(rnd.randint(10, 400)),
                )
            )
    session.add_all(meters)
    await session.flush()

    apartments_by_id = {a.id: a for a in apartments}
    for meter in meters:
        value = meter.initial_value
        people = apartments_by_id[meter.apartment_id].residents_count
        lazy = rnd.random() < 0.2
        for offset in range(5, -1, -1):
            period = periods.add_months(current, -offset)
            if offset == 0 and (lazy or now.astimezone(tz).day < 2):
                continue
            if offset in (1, 2) and lazy:
                continue
            day = (
                min(rnd.randint(18, 25), now.astimezone(tz).day)
                if offset == 0
                else rnd.randint(18, 25)
            )
            taken_at = datetime(period.year, period.month, day, 10, tzinfo=tz)
            if taken_at > now:
                continue
            spread = Decimal(rnd.randint(70, 130)) / 100
            value += (_MONTHLY_PER_PERSON[meter.kind] * people * spread).quantize(Decimal("0.001"))
            session.add(
                MeterReading(
                    meter_id=meter.id,
                    value=value,
                    taken_at=taken_at,
                    source=ReadingSource.PROVIDER
                    if meter.kind == MeterKind.ELECTRICITY
                    else rnd.choice(
                        [ReadingSource.RESIDENT, ReadingSource.RESIDENT, ReadingSource.STAFF]
                    ),
                )
            )
    await session.flush()

    # Начисления за три прошедших месяца и оплаты: кто-то платит исправно, кто-то копит долг.
    for offset in (5, 4, 3, 2, 1):
        period = periods.add_months(current, -offset)
        await run_billing(session, period)
        await issue_period(session, period)
        _, period_end = periods.bounds(period, tz)
        for apartment in apartments:
            behaviour = apartment.id % 7
            if behaviour == 0:
                continue  # злостный неплательщик
            summary = await account_summary(session, apartment.id)
            if summary.balance <= 0:
                continue
            amount = (
                summary.balance
                if behaviour != 3
                else (summary.balance / 2).quantize(Decimal("0.01"))
            )
            session.add(
                Payment(
                    apartment_id=apartment.id,
                    amount=amount,
                    paid_at=period_end + timedelta(days=rnd.randint(2, 9), hours=12),
                    method=rnd.choice(list(PaymentMethod)),
                    reference=f"DEMO-{period:%Y%m}-{apartment.account_number}",
                    created_by_id=accountant.id,
                )
            )
            await session.flush()
            await reallocate_payments(session, apartment.id)
    # Текущий месяц — черновики: бухгалтер может проверить и выставить их сам.
    await run_billing(session, current)

    # Заявки в разных статусах.
    ticket_specs = [
        (0, TicketCategory.PLUMBING, TicketPriority.HIGH, TicketStatus.IN_PROGRESS,
         "Течёт стояк в ванной", "Подтекает соединение на стояке ГВС, под ванной лужа.", 1),
        (1, TicketCategory.ELEVATOR, TicketPriority.EMERGENCY, TicketStatus.NEW,
         "Не работает лифт во 2 подъезде", "Лифт стоит на 5 этаже, двери не открываются.", 0),
        (2, TicketCategory.CLEANING, TicketPriority.LOW, TicketStatus.RESOLVED,
         "Не убрана лестничная клетка", "На 3 этаже второй день не моют полы.", 4),
        (3, TicketCategory.INTERCOM, TicketPriority.NORMAL, TicketStatus.WAITING,
         "Не работает домофон", "Трубка в квартире молчит, звонок с улицы не проходит.", 2),
        (14, TicketCategory.TERRITORY, TicketPriority.NORMAL, TicketStatus.CLOSED,
         "Яма во дворе", "Возле второго подъезда провал асфальта.", 9),
        (4, TicketCategory.HEATING, TicketPriority.HIGH, TicketStatus.NEW,
         "Холодные батареи", "В квартире +17, батареи едва тёплые.", 0),
    ]  # fmt: skip
    for index, category, priority, status, subject, description, days_ago in ticket_specs:
        apartment = apartments[index]
        author = residents[index] if index < len(residents) else manager
        created = now - timedelta(days=days_ago, hours=rnd.randint(1, 10))
        ticket = Ticket(
            building_id=apartment.building_id,
            apartment_id=apartment.id,
            author_id=author.id,
            assignee_id=manager.id if status != TicketStatus.NEW else None,
            category=category,
            priority=priority,
            status=status,
            subject=subject,
            description=description,
            due_at=created + TICKET_SLA[priority],
            resolved_at=created + timedelta(days=1)
            if status in (TicketStatus.RESOLVED, TicketStatus.CLOSED)
            else None,
            closed_at=created + timedelta(days=2) if status == TicketStatus.CLOSED else None,
            rating=5 if status == TicketStatus.CLOSED else None,
            created_at=created,
            comments=[TicketComment(author_id=author.id, body="Прошу решить как можно скорее.")]
            if status != TicketStatus.NEW
            else [],
        )
        session.add(ticket)

    # Пропуска: разовые гостевые, автомобильный на согласовании, курьер.
    session.add_all(
        [
            Pass(
                code="GST7K2",
                apartment_id=apartments[0].id,
                created_by_id=demo_resident.id,
                kind=PassKind.GUEST,
                visitor_name="Сергей Гостев",
                valid_from=now - timedelta(hours=1),
                valid_until=now + timedelta(hours=10),
                is_one_time=True,
                status=PassStatus.ACTIVE,
            ),
            Pass(
                code="CAR4M9",
                apartment_id=apartments[0].id,
                created_by_id=demo_resident.id,
                kind=PassKind.VEHICLE,
                visitor_name="Родители",
                vehicle_plate="А123ВС777",
                valid_from=now,
                valid_until=now + timedelta(days=30),
                is_one_time=False,
                status=PassStatus.PENDING,
            ),
            Pass(
                code="DLV8P3",
                apartment_id=apartments[2].id,
                created_by_id=residents[2].id,
                kind=PassKind.DELIVERY,
                visitor_name="Доставка мебели",
                vehicle_plate="Х555ХХ199",
                valid_from=now + timedelta(days=1),
                valid_until=now + timedelta(days=1, hours=6),
                is_one_time=True,
                status=PassStatus.ACTIVE,
            ),
        ]
    )

    session.add_all(
        [
            Announcement(
                title="Плановое отключение горячей воды",
                body="С 10:00 до 18:00 в связи с ремонтом теплотрассы будет отключена "
                "горячая вода. Приносим извинения за неудобства.",
                building_id=buildings[0].id,
                is_pinned=True,
                author_id=manager.id,
            ),
            Announcement(
                title="Передайте показания счётчиков до 25 числа",
                body="Показания можно передать в личном кабинете в разделе «Счётчики». "
                "Если показания не переданы, начисление будет по среднему.",
                author_id=manager.id,
            ),
            Announcement(
                title="Общее собрание собственников",
                body="Приглашаем на общее собрание собственников во дворе дома в субботу в 12:00.",
                building_id=buildings[1].id,
                author_id=manager.id,
            ),
        ]
    )

    _, api_key = await create_api_key(session, "Демо: шлюз АСКУЭ", admin)
    await session.flush()

    return "\n".join(
        [
            "Демо-данные загружены. Пароль для всех учётных записей: " + DEMO_PASSWORD,
            "  admin@demo.ru       — администратор",
            "  manager@demo.ru     — управляющий/диспетчер",
            "  buh@demo.ru         — бухгалтер",
            "  guard@demo.ru       — охрана",
            "  resident@demo.ru    — житель (кв. 1, ул. Лесная, 12)",
            f"API-ключ для приёма показаний: {api_key}",
        ]
    )
