"""Сводка для главной страницы кабинета УК."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import SessionDep, StaffUser
from app.billing import periods
from app.billing.models import POSTED_STATUSES, Invoice, Payment
from app.billing.service import debtors_query
from app.core.config import get_settings
from app.housing.models import Apartment, Building
from app.meters.models import Meter, MeterReading
from app.passes.models import Pass, PassStatus
from app.tickets.models import OPEN_STATUSES, Ticket, TicketCategory, TicketPriority, TicketStatus
from app.users.models import User, UserRole

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

HISTORY_MONTHS = 6


class TicketStats(BaseModel):
    open: int
    new: int
    overdue: int
    emergency: int
    by_category: dict[TicketCategory, int]


class ReadingStats(BaseModel):
    period: date
    active_meters: int
    meters_with_readings: int
    verification_due_30d: int


class BillingMonth(BaseModel):
    period: date
    charged: Decimal
    paid: Decimal


class BillingStats(BaseModel):
    total_debt: Decimal
    debtors: int
    history: list[BillingMonth]


class PassStats(BaseModel):
    pending: int
    active_now: int


class Dashboard(BaseModel):
    buildings: int
    apartments: int
    residents: int
    tickets: TicketStats
    readings: ReadingStats
    billing: BillingStats
    passes: PassStats


async def _count(session: AsyncSession, stmt: Select[Any]) -> int:
    return int(await session.scalar(stmt) or 0)


@router.get("", response_model=Dashboard, summary="Сводка по УК")
async def dashboard(session: SessionDep, _: StaffUser) -> Dashboard:
    tz = get_settings().tz
    now = datetime.now(UTC)
    current_period = periods.first_day(now.astimezone(tz).date())
    period_start, _period_end = periods.bounds(current_period, tz)

    open_tickets = select(func.count(Ticket.id)).where(Ticket.status.in_(OPEN_STATUSES))
    by_category = dict(
        (
            await session.execute(
                select(Ticket.category, func.count(Ticket.id))
                .where(Ticket.status.in_(OPEN_STATUSES))
                .group_by(Ticket.category)
            )
        ).all()
    )
    tickets = TicketStats(
        open=await _count(session, open_tickets),
        new=await _count(session, open_tickets.where(Ticket.status == TicketStatus.NEW)),
        overdue=await _count(session, open_tickets.where(Ticket.due_at < now)),
        emergency=await _count(
            session, open_tickets.where(Ticket.priority == TicketPriority.EMERGENCY)
        ),
        by_category=by_category,
    )

    active_meters = select(func.count(Meter.id)).where(Meter.is_active.is_(True))
    readings = ReadingStats(
        period=current_period,
        active_meters=await _count(session, active_meters),
        meters_with_readings=await _count(
            session,
            select(func.count(func.distinct(MeterReading.meter_id)))
            .join(Meter, Meter.id == MeterReading.meter_id)
            .where(Meter.is_active.is_(True), MeterReading.taken_at >= period_start),
        ),
        verification_due_30d=await _count(
            session,
            active_meters.where(Meter.verification_due <= now.date() + timedelta(days=30)),
        ),
    )

    debt_rows = debtors_query(building_id=None, min_debt=Decimal(0)).subquery()
    total_debt, debtors = (
        await session.execute(select(func.coalesce(func.sum(debt_rows.c.balance), 0), func.count()))
    ).one()

    history: list[BillingMonth] = []
    for offset in range(HISTORY_MONTHS - 1, -1, -1):
        period = periods.add_months(current_period, -offset)
        start, end = periods.bounds(period, tz)
        charged = await session.scalar(
            select(func.coalesce(func.sum(Invoice.amount), 0)).where(
                Invoice.period == period, Invoice.status.in_(POSTED_STATUSES)
            )
        )
        paid = await session.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.paid_at >= start, Payment.paid_at < end
            )
        )
        history.append(BillingMonth(period=period, charged=charged or 0, paid=paid or 0))

    passes = PassStats(
        pending=await _count(
            session, select(func.count(Pass.id)).where(Pass.status == PassStatus.PENDING)
        ),
        active_now=await _count(
            session,
            select(func.count(Pass.id)).where(
                Pass.status == PassStatus.ACTIVE, Pass.valid_from <= now, Pass.valid_until > now
            ),
        ),
    )

    return Dashboard(
        buildings=await _count(session, select(func.count(Building.id))),
        apartments=await _count(session, select(func.count(Apartment.id))),
        residents=await _count(
            session,
            select(func.count(User.id)).where(
                User.role == UserRole.RESIDENT, User.is_active.is_(True)
            ),
        ),
        tickets=tickets,
        readings=readings,
        billing=BillingStats(total_debt=total_debt, debtors=debtors, history=history),
        passes=passes,
    )
