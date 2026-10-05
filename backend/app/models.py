"""Единая точка импорта всех ORM-моделей — нужна Alembic и тестам для полного metadata."""

from app.core.database import Base
from app.housing.models import Apartment, Building, apartment_residents
from app.integrations.models import ApiKey, MeterDataSource
from app.meters.models import Meter, MeterReading
from app.users.models import User

__all__ = [
    "Apartment",
    "ApiKey",
    "Base",
    "Building",
    "Meter",
    "MeterDataSource",
    "MeterReading",
    "User",
    "apartment_residents",
]
