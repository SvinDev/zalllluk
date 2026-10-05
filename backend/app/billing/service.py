from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.billing import periods
from app.billing.calculator import InvoiceCalculator
from app.billing.models import (
    POSTED_STATUSES,
    Invoice,
    InvoiceStatus,
    Payment,
    Tariff,
)
from app.billing.schemas import (
    AccountSummary,
    BillingRunReport,
    PaymentCreate,
    TariffCreate,
    TariffUpdate,
)
from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.housing.models import Apartment, Building
from app.housing.service import resident_apartment_ids, restrict_to_apartments
from app.meters.models import Meter
from app.users.models import User

# Ключ advisory-lock: биллинг одного периода не должен идти параллельно.
_BILLING_LOCK = 0x554B_4249  # "UKBI"

# Срок оплаты — до 10-го числа месяца, следующего за расчётным (ст. 155 ЖК РФ).
PAYMENT_DUE_DAY = 10


# ---------- Тарифы ----------


async def get_tariff(session: AsyncSession, tariff_id: int) -> Tariff:
    tariff = await session.get(Tariff, tariff_id)
    if tariff is None:
        raise NotFoundError("Тариф не найден")
    return tariff


def tariffs_query(*, active_on: date | None, building_id: int | None) -> Select[Any]:
    stmt = select(Tariff).order_by(Tariff.name, Tariff.valid_from.desc())
    if active_on is not None:
        stmt = stmt.where(
            Tariff.valid_from <= active_on,
            or_(Tariff.valid_to.is_(None), Tariff.valid_to >= active_on),
        )
    if building_id is not None:
        stmt = stmt.where(or_(Tariff.building_id.is_(None), Tariff.building_id == building_id))
    return stmt


async def create_tariff(session: AsyncSession, data: TariffCreate) -> Tariff:
    if data.building_id is not None and await session.get(Building, data.building_id) is None:
        raise NotFoundError("Дом не найден")
    tariff = Tariff(**data.model_dump())
    session.add(tariff)
    await session.flush()
    return tariff


async def update_tariff(session: AsyncSession, tariff: Tariff, data: TariffUpdate) -> Tariff:
    changes = data.model_dump(exclude_unset=True)
    valid_to = changes.get("valid_to", tariff.valid_to)
    if valid_to is not None and valid_to < tariff.valid_from:
        raise BusinessRuleError("Дата окончания раньше даты начала действия")
    for field, value in changes.items():
        setattr(tariff, field, value)
    await session.flush()
    return tariff


# ---------- Расчёт ----------


def _check_period(period: date) -> None:
    today = datetime.now(get_settings().tz).date()
    if period > periods.first_day(today):
        raise BusinessRuleError("Нельзя начислять за будущий период")


async def _invoice_number(session: AsyncSession, apartment: Apartment, period: date) -> str:
    base = f"{apartment.account_number}-{period:%Y%m}"
    taken = await session.scalar(
        select(func.count(Invoice.id)).where(
            Invoice.apartment_id == apartment.id, Invoice.period == period
        )
    )
    return base if not taken else f"{base}-{taken + 1}"


async def run_billing(
    session: AsyncSession, period: date, building_id: int | None = None
) -> BillingRunReport:
    """Формирует черновики квитанций за период.

    Повторный запуск пересчитывает черновики (например, после ввода поздних
    показаний), а выставленные квитанции не трогает.
    """
    period = periods.first_day(period)
    _check_period(period)
    await session.execute(
        select(func.pg_advisory_xact_lock(_BILLING_LOCK, period.year * 100 + period.month))
    )

    apartments_stmt = select(Apartment).options(joinedload(Apartment.building))
    if building_id is not None:
        apartments_stmt = apartments_stmt.where(Apartment.building_id == building_id)
    apartments = list(await session.scalars(apartments_stmt.order_by(Apartment.id)))
    apartment_ids = [a.id for a in apartments]

    # Тариф применяется к периоду, если действует на его первое число:
    # так смена ставки «с 1 июля» не приводит к двойному начислению за месяц.
    tariffs = list(await session.scalars(tariffs_query(active_on=period, building_id=None)))

    meters_by_apartment: dict[int, list[Meter]] = defaultdict(list)
    for meter in await session.scalars(
        select(Meter).where(Meter.apartment_id.in_(apartment_ids)).order_by(Meter.id)
    ):
        meters_by_apartment[meter.apartment_id].append(meter)

    existing = {
        invoice.apartment_id: invoice
        for invoice in await session.scalars(
            select(Invoice).where(
                Invoice.apartment_id.in_(apartment_ids),
                Invoice.period == period,
                Invoice.status != InvoiceStatus.CANCELLED,
            )
        )
    }

    calculator = InvoiceCalculator(session, period, get_settings().tz)
    report = BillingRunReport(
        period=period,
        created=0,
        regenerated=0,
        skipped_posted=0,
        without_charges=0,
        total_amount=Decimal(0),
    )
    for apartment in apartments:
        current = existing.get(apartment.id)
        if current is not None and current.status != InvoiceStatus.DRAFT:
            report.skipped_posted += 1
            continue

        applicable = [
            t for t in tariffs if t.building_id is None or t.building_id == apartment.building_id
        ]
        lines = await calculator.calculate(apartment, applicable, meters_by_apartment[apartment.id])
        if current is not None:
            await session.delete(current)
            await session.flush()
        if not lines:
            report.without_charges += 1
            continue

        invoice = Invoice(
            apartment_id=apartment.id,
            period=period,
            number=await _invoice_number(session, apartment, period),
            status=InvoiceStatus.DRAFT,
            amount=sum((line.amount for line in lines), Decimal(0)),
            lines=[line.to_model() for line in lines],
        )
        session.add(invoice)
        await session.flush()
        report.total_amount += invoice.amount
        if current is None:
            report.created += 1
        else:
            report.regenerated += 1
    return report


# ---------- Выставление и аннулирование ----------


async def account_summary(session: AsyncSession, apartment_id: int) -> AccountSummary:
    charged = await session.scalar(
        select(func.coalesce(func.sum(Invoice.amount), 0)).where(
            Invoice.apartment_id == apartment_id, Invoice.status.in_(POSTED_STATUSES)
        )
    )
    paid, last_payment_at = (
        await session.execute(
            select(func.coalesce(func.sum(Payment.amount), 0), func.max(Payment.paid_at)).where(
                Payment.apartment_id == apartment_id
            )
        )
    ).one()
    charged, paid = Decimal(charged or 0), Decimal(paid or 0)
    return AccountSummary(
        apartment_id=apartment_id,
        charged=charged,
        paid=paid,
        balance=charged - paid,
        last_payment_at=last_payment_at,
    )


async def reallocate_payments(session: AsyncSession, apartment_id: int) -> None:
    """Разносит все оплаты лицевого счёта по квитанциям от старых к новым (FIFO).

    Пересчёт целиком, а не инкрементально: так корректно отрабатываются
    аннулирование квитанций, переплаты и оплаты «вперёд».
    """
    await session.execute(
        select(Apartment.id).where(Apartment.id == apartment_id).with_for_update()
    )
    pool = Decimal(
        await session.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.apartment_id == apartment_id
            )
        )
        or 0
    )
    invoices = await session.scalars(
        select(Invoice)
        .where(Invoice.apartment_id == apartment_id, Invoice.status.in_(POSTED_STATUSES))
        .order_by(Invoice.period, Invoice.id)
    )
    for invoice in invoices:
        allocated = min(pool, invoice.amount)
        pool -= allocated
        invoice.paid_amount = allocated
        if allocated >= invoice.amount:
            invoice.status = InvoiceStatus.PAID
        elif allocated > 0:
            invoice.status = InvoiceStatus.PARTIALLY_PAID
        else:
            invoice.status = InvoiceStatus.ISSUED
    await session.flush()


async def issue_invoice(session: AsyncSession, invoice: Invoice) -> Invoice:
    if invoice.status != InvoiceStatus.DRAFT:
        raise BusinessRuleError("Выставить можно только черновик")
    summary = await account_summary(session, invoice.apartment_id)
    invoice.opening_balance = summary.balance
    invoice.status = InvoiceStatus.ISSUED
    invoice.issued_at = datetime.now(UTC)
    invoice.due_date = periods.add_months(invoice.period, 1).replace(day=PAYMENT_DUE_DAY)
    await session.flush()
    await reallocate_payments(session, invoice.apartment_id)
    return invoice


async def issue_period(session: AsyncSession, period: date, building_id: int | None = None) -> int:
    stmt = (
        select(Invoice)
        .where(Invoice.period == periods.first_day(period), Invoice.status == InvoiceStatus.DRAFT)
        .order_by(Invoice.id)
    )
    if building_id is not None:
        stmt = stmt.join(Invoice.apartment).where(Apartment.building_id == building_id)
    drafts = list(await session.scalars(stmt))
    for invoice in drafts:
        await issue_invoice(session, invoice)
    return len(drafts)


async def cancel_invoice(session: AsyncSession, invoice: Invoice) -> Invoice | None:
    """Черновик удаляется, выставленная квитанция — аннулируется с переразноской оплат."""
    if invoice.status == InvoiceStatus.CANCELLED:
        raise BusinessRuleError("Квитанция уже аннулирована")
    if invoice.status == InvoiceStatus.DRAFT:
        await session.delete(invoice)
        await session.flush()
        return None
    invoice.status = InvoiceStatus.CANCELLED
    invoice.paid_amount = Decimal(0)
    await session.flush()
    await reallocate_payments(session, invoice.apartment_id)
    return invoice


# ---------- Просмотр квитанций ----------


def invoices_query(
    apartment_ids: list[int] | None,
    *,
    period: date | None = None,
    status: InvoiceStatus | None = None,
    building_id: int | None = None,
    apartment_id: int | None = None,
    search: str | None = None,
) -> Select[Any]:
    stmt = (
        select(Invoice)
        .join(Invoice.apartment)
        .options(joinedload(Invoice.apartment).joinedload(Apartment.building))
        .order_by(Invoice.period.desc(), Invoice.id.desc())
    )
    stmt = restrict_to_apartments(stmt, Invoice.apartment_id, apartment_ids)
    if apartment_ids is not None:
        # Жителям черновики не показываем.
        stmt = stmt.where(Invoice.status != InvoiceStatus.DRAFT)
    if period is not None:
        stmt = stmt.where(Invoice.period == periods.first_day(period))
    if status is not None:
        stmt = stmt.where(Invoice.status == status)
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    if apartment_id is not None:
        stmt = stmt.where(Invoice.apartment_id == apartment_id)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Invoice.number.ilike(pattern), Apartment.account_number.ilike(pattern))
        )
    return stmt


async def get_invoice_for_user(session: AsyncSession, user: User, invoice_id: int) -> Invoice:
    invoice = await session.get(
        Invoice,
        invoice_id,
        options=[
            joinedload(Invoice.apartment).joinedload(Apartment.building),
            selectinload(Invoice.lines),
        ],
        populate_existing=True,
    )
    ids = await resident_apartment_ids(session, user)
    if invoice is None or (
        ids is not None
        and (invoice.apartment_id not in ids or invoice.status == InvoiceStatus.DRAFT)
    ):
        raise NotFoundError("Квитанция не найдена")
    return invoice


# ---------- Оплаты ----------


async def register_payment(session: AsyncSession, data: PaymentCreate, actor: User) -> Payment:
    if data.apartment_id is not None:
        apartment = await session.get(Apartment, data.apartment_id)
    else:
        apartment = await session.scalar(
            select(Apartment).where(Apartment.account_number == data.account_number)
        )
    if apartment is None:
        raise NotFoundError("Лицевой счёт не найден")
    if data.reference:
        duplicate = await session.scalar(
            select(Payment.id).where(Payment.reference == data.reference)
        )
        if duplicate is not None:
            raise ConflictError(f"Платёж с номером {data.reference} уже учтён")

    payment = Payment(
        apartment_id=apartment.id,
        amount=data.amount,
        paid_at=data.paid_at or datetime.now(UTC),
        method=data.method,
        reference=data.reference,
        comment=data.comment,
        created_by_id=actor.id,
    )
    session.add(payment)
    await session.flush()
    await reallocate_payments(session, apartment.id)
    return payment


def payments_query(
    apartment_ids: list[int] | None,
    *,
    apartment_id: int | None = None,
    building_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Select[Any]:
    stmt = (
        select(Payment)
        .join(Payment.apartment)
        .options(joinedload(Payment.apartment).joinedload(Apartment.building))
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
    )
    stmt = restrict_to_apartments(stmt, Payment.apartment_id, apartment_ids)
    if apartment_id is not None:
        stmt = stmt.where(Payment.apartment_id == apartment_id)
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    tz = get_settings().tz
    if date_from is not None:
        stmt = stmt.where(Payment.paid_at >= datetime.combine(date_from, time.min, tz))
    if date_to is not None:
        stmt = stmt.where(
            Payment.paid_at < datetime.combine(date_to + timedelta(days=1), time.min, tz)
        )
    return stmt


def debtors_query(*, building_id: int | None, min_debt: Decimal) -> Select[Any]:
    charged = (
        select(Invoice.apartment_id, func.sum(Invoice.amount).label("charged"))
        .where(Invoice.status.in_(POSTED_STATUSES))
        .group_by(Invoice.apartment_id)
        .subquery()
    )
    paid = (
        select(
            Payment.apartment_id,
            func.sum(Payment.amount).label("paid"),
            func.max(Payment.paid_at).label("last_payment_at"),
        )
        .group_by(Payment.apartment_id)
        .subquery()
    )
    balance = (func.coalesce(charged.c.charged, 0) - func.coalesce(paid.c.paid, 0)).label("balance")
    stmt = (
        select(Apartment, balance, paid.c.last_payment_at)
        .join(charged, charged.c.apartment_id == Apartment.id)
        .outerjoin(paid, paid.c.apartment_id == Apartment.id)
        .options(joinedload(Apartment.building))
        .where(balance > min_debt)
        .order_by(balance.desc(), Apartment.id)
    )
    if building_id is not None:
        stmt = stmt.where(Apartment.building_id == building_id)
    return stmt
