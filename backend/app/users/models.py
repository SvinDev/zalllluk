from enum import StrEnum

from sqlalchemy import String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin, str_enum


class UserRole(StrEnum):
    ADMIN = "admin"  # администратор УК: всё, включая сотрудников и интеграции
    MANAGER = "manager"  # управляющий/диспетчер: жилфонд, обращения, пропуска
    ACCOUNTANT = "accountant"  # бухгалтер: тарифы, начисления, оплаты
    SECURITY = "security"  # охрана/консьерж: проверка пропусков
    RESIDENT = "resident"  # житель/собственник


STAFF_ROLES = frozenset({UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.SECURITY})


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF_ROLES

    def __repr__(self) -> str:
        return f"User(id={self.id}, email={self.email!r}, role={self.role})"
