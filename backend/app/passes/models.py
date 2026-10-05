from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, str_enum
from app.housing.models import Apartment
from app.users.models import User


class PassKind(StrEnum):
    GUEST = "guest"  # пеший гость
    VEHICLE = "vehicle"  # въезд автомобиля
    DELIVERY = "delivery"  # курьер, доставка, грузовой транспорт


class PassStatus(StrEnum):
    PENDING = "pending"  # ждёт согласования УК
    ACTIVE = "active"
    REJECTED = "rejected"
    USED = "used"  # разовый пропуск уже использован
    CANCELLED = "cancelled"


class Pass(TimestampMixin, Base):
    __tablename__ = "passes"
    __table_args__ = (CheckConstraint("valid_until > valid_from", name="valid_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Короткий код, который гость называет на посту охраны.
    code: Mapped[str] = mapped_column(String(16), unique=True)
    apartment_id: Mapped[int] = mapped_column(
        ForeignKey("apartments.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[PassKind] = mapped_column(str_enum(PassKind))
    visitor_name: Mapped[str | None] = mapped_column(String(255))
    # Номер хранится нормализованным: заглавная кириллица и цифры без пробелов.
    vehicle_plate: Mapped[str | None] = mapped_column(String(16), index=True)
    comment: Mapped[str | None] = mapped_column(Text)
    valid_from: Mapped[datetime]
    valid_until: Mapped[datetime] = mapped_column(index=True)
    is_one_time: Mapped[bool] = mapped_column(default=True, server_default=true())
    status: Mapped[PassStatus] = mapped_column(str_enum(PassStatus), index=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None]
    reject_reason: Mapped[str | None] = mapped_column(Text)

    apartment: Mapped[Apartment] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    visits: Mapped[list["PassVisit"]] = relationship(
        back_populates="pass_",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PassVisit.id",
    )

    @property
    def effective_status(self) -> str:
        """Статус с учётом времени: активный пропуск после окончания срока — «expired»."""
        if self.status == PassStatus.ACTIVE and self.valid_until <= datetime.now(UTC):
            return "expired"
        return self.status.value

    def is_valid_at(self, moment: datetime) -> bool:
        return self.status == PassStatus.ACTIVE and self.valid_from <= moment < self.valid_until


class PassVisit(Base):
    """Отметка охраны о проходе/въезде по пропуску."""

    __tablename__ = "pass_visits"
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[int] = mapped_column(primary_key=True)
    pass_id: Mapped[int] = mapped_column(ForeignKey("passes.id", ondelete="CASCADE"), index=True)
    checked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    entered_at: Mapped[datetime] = mapped_column(server_default=func.now())
    note: Mapped[str | None] = mapped_column(String(500))

    pass_: Mapped[Pass] = relationship(back_populates="visits")
    checked_by: Mapped[User | None] = relationship()
