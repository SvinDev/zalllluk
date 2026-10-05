"""Единая точка импорта всех ORM-моделей — нужна Alembic и тестам для полного metadata."""

from app.core.database import Base

__all__ = ["Base"]
