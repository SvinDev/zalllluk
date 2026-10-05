"""Расчётный период — календарный месяц в часовом поясе УК."""

from calendar import monthrange
from datetime import date, datetime, time
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import BeforeValidator


def first_day(value: date) -> date:
    return value.replace(day=1)


def add_months(period: date, months: int) -> date:
    index = period.year * 12 + period.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def days_in(period: date) -> int:
    return monthrange(period.year, period.month)[1]


def bounds(period: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """[начало, конец) месяца как aware-datetime в поясе УК."""
    start = datetime.combine(first_day(period), time.min, tzinfo=tz)
    end = datetime.combine(add_months(first_day(period), 1), time.min, tzinfo=tz)
    return start, end


def _parse_period(value: object) -> object:
    """Принимает «2026-09» или любую дату месяца и приводит к первому числу."""
    if isinstance(value, str) and len(value) == 7:
        value = f"{value}-01"
    if isinstance(value, str):
        value = date.fromisoformat(value)
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return first_day(value)
    return value


Period = Annotated[date, BeforeValidator(_parse_period)]
