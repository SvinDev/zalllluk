"""Единая точка импорта всех ORM-моделей — нужна Alembic и тестам для полного metadata."""

from app.billing.models import Invoice, InvoiceLine, Payment, Tariff
from app.core.database import Base
from app.housing.models import Apartment, Building, apartment_residents
from app.integrations.models import ApiKey, MeterDataSource
from app.meters.models import Meter, MeterReading
from app.tickets.models import Ticket, TicketComment
from app.users.models import User

__all__ = [
    "Apartment",
    "ApiKey",
    "Base",
    "Building",
    "Invoice",
    "InvoiceLine",
    "Meter",
    "MeterDataSource",
    "MeterReading",
    "Payment",
    "Tariff",
    "Ticket",
    "TicketComment",
    "User",
    "apartment_residents",
]
