"""Единая точка импорта всех ORM-моделей — нужна Alembic и тестам для полного metadata."""

from app.core.database import Base
from app.housing.models import Apartment, Building, apartment_residents
from app.users.models import User

__all__ = ["Apartment", "Base", "Building", "User", "apartment_residents"]
