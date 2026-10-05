from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, str_enum
from app.housing.models import Apartment


class MeterKind(StrEnum):
    COLD_WATER = "cold_water"
    HOT_WATER = "hot_water"
    ELECTRICITY = "electricity"
    HEATING = "heating"
    GAS = "gas"


METER_UNITS: dict[MeterKind, str] = {
    MeterKind.COLD_WATER: "м³",
    MeterKind.HOT_WATER: "м³",
    MeterKind.ELECTRICITY: "кВт·ч",
    MeterKind.HEATING: "Гкал",
    MeterKind.GAS: "м³",
}


class ReadingSource(StrEnum):
    RESIDENT = "resident"  # передал житель в личном кабинете
    STAFF = "staff"  # внёс сотрудник УК (обход, звонок)
    API = "api"  # пришло во входящий API от внешней системы
    PROVIDER = "provider"  # забрали опросом внешней системы учёта


class Meter(TimestampMixin, Base):
    """Индивидуальный прибор учёта в помещении."""

    __tablename__ = "meters"

    id: Mapped[int] = mapped_column(primary_key=True)
    apartment_id: Mapped[int] = mapped_column(
        ForeignKey("apartments.id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[MeterKind] = mapped_column(str_enum(MeterKind))
    serial_number: Mapped[str] = mapped_column(String(64), unique=True)
    # Идентификатор прибора во внешней системе (АСКУЭ, IoT-платформа).
    external_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    installed_at: Mapped[date | None]
    verification_due: Mapped[date | None] = mapped_column(index=True)
    initial_value: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())

    apartment: Mapped[Apartment] = relationship()

    @property
    def unit(self) -> str:
        return METER_UNITS[self.kind]


class MeterReading(Base):
    __tablename__ = "meter_readings"
    __table_args__ = (
        # Одно показание на момент времени: делает приём из внешних систем идемпотентным.
        # Заодно это индекс для выборок «последнее показание счётчика до даты».
        UniqueConstraint("meter_id", "taken_at"),
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[int] = mapped_column(primary_key=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id", ondelete="CASCADE"))
    value: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    taken_at: Mapped[datetime] = mapped_column(index=True)
    source: Mapped[ReadingSource] = mapped_column(str_enum(ReadingSource))
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    meter: Mapped[Meter] = relationship()
