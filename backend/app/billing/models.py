from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, str_enum
from app.housing.models import Apartment
from app.meters.models import METER_UNITS, MeterKind

MONEY = Numeric(12, 2)
RATE = Numeric(12, 4)
QUANTITY = Numeric(14, 3)


class TariffMethod(StrEnum):
    PER_AREA = "per_area"  # ставка × площадь: содержание жилья, капремонт
    PER_RESIDENT = "per_resident"  # ставка × проживающие: вывоз ТКО
    METERED = "metered"  # ставка × расход по счётчику: вода, электроэнергия
    FIXED = "fixed"  # фиксированная сумма с помещения: домофон, антенна


_METHOD_UNITS = {
    TariffMethod.PER_AREA: "м²",
    TariffMethod.PER_RESIDENT: "чел.",
    TariffMethod.FIXED: "мес.",
}


class Tariff(TimestampMixin, Base):
    """Услуга и её ставка на период действия. building_id = NULL — для всех домов."""

    __tablename__ = "tariffs"
    __table_args__ = (
        CheckConstraint("rate >= 0", name="rate_non_negative"),
        CheckConstraint("method <> 'metered' OR meter_kind IS NOT NULL", name="metered_kind"),
        CheckConstraint("valid_to IS NULL OR valid_to >= valid_from", name="valid_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    method: Mapped[TariffMethod] = mapped_column(str_enum(TariffMethod))
    meter_kind: Mapped[MeterKind | None] = mapped_column(str_enum(MeterKind))
    rate: Mapped[Decimal] = mapped_column(RATE)
    # Норматив потребления на 1 человека в месяц — когда нет ни показаний, ни истории.
    normative: Mapped[Decimal | None] = mapped_column(RATE)
    building_id: Mapped[int | None] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    valid_from: Mapped[date]
    valid_to: Mapped[date | None]

    @property
    def unit(self) -> str:
        if self.method == TariffMethod.METERED and self.meter_kind:
            return METER_UNITS[self.meter_kind]
        return _METHOD_UNITS.get(self.method, "")


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    ISSUED = "issued"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"
    CANCELLED = "cancelled"


# Квитанции, которые участвуют в расчёте долга лицевого счёта.
POSTED_STATUSES = (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID)


class Invoice(TimestampMixin, Base):
    """Квитанция (платёжный документ) по лицевому счёту за месяц."""

    __tablename__ = "invoices"
    __table_args__ = (
        # Одна действующая квитанция на лицевой счёт за период; аннулированные не мешают.
        Index(
            "uq_invoices_apartment_period_active",
            "apartment_id",
            "period",
            unique=True,
            postgresql_where=text("status <> 'cancelled'"),
        ),
        CheckConstraint("EXTRACT(DAY FROM period) = 1", name="period_first_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(64), unique=True)
    apartment_id: Mapped[int] = mapped_column(
        ForeignKey("apartments.id", ondelete="RESTRICT"), index=True
    )
    period: Mapped[date] = mapped_column(index=True)
    status: Mapped[InvoiceStatus] = mapped_column(
        str_enum(InvoiceStatus), default=InvoiceStatus.DRAFT, index=True
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0))
    # Долг (+) или аванс (−) по лицевому счёту на момент выставления.
    opening_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    # Сколько оплат разнесено на эту квитанцию (FIFO по периодам).
    paid_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    due_date: Mapped[date | None]
    issued_at: Mapped[datetime | None]

    apartment: Mapped[Apartment] = relationship()
    lines: Mapped[list["InvoiceLine"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        passive_deletes=True,  # строки удаляет ON DELETE CASCADE, без загрузки в память
        order_by="InvoiceLine.id",
    )

    @property
    def total_due(self) -> Decimal:
        """«Итого к оплате» в квитанции: начислено + долг прошлых периодов (не меньше нуля)."""
        return max(self.amount + self.opening_balance, Decimal(0))


class CalculationBasis(StrEnum):
    TARIFF = "tariff"  # площадь, проживающие или фиксированная сумма
    METER = "meter"  # по показаниям прибора учёта
    AVERAGE = "average"  # по среднемесячному расходу (нет показаний)
    NORMATIVE = "normative"  # по нормативу потребления
    RECALCULATION = "recalculation"  # снятие начисленного «по среднему» после передачи показаний


ESTIMATED_BASES = (CalculationBasis.AVERAGE, CalculationBasis.NORMATIVE)


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), index=True
    )
    tariff_id: Mapped[int | None] = mapped_column(ForeignKey("tariffs.id", ondelete="SET NULL"))
    meter_id: Mapped[int | None] = mapped_column(
        ForeignKey("meters.id", ondelete="SET NULL"), index=True
    )
    service_name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[Decimal] = mapped_column(QUANTITY)
    rate: Mapped[Decimal] = mapped_column(RATE)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    basis: Mapped[CalculationBasis] = mapped_column(str_enum(CalculationBasis))
    # Предыдущие и текущие показания — печатаются в квитанции и служат точкой отсчёта
    # для следующего начисления по этому счётчику.
    reading_from: Mapped[Decimal | None] = mapped_column(QUANTITY)
    reading_to: Mapped[Decimal | None] = mapped_column(QUANTITY)
    details: Mapped[str | None] = mapped_column(Text)

    invoice: Mapped[Invoice] = relationship(back_populates="lines")


class PaymentMethod(StrEnum):
    BANK = "bank"  # банковский перевод / реестр банка
    CARD = "card"  # эквайринг, СБП
    CASH = "cash"  # касса УК
    OTHER = "other"


class Payment(TimestampMixin, Base):
    """Оплата поступает на лицевой счёт и разносится по квитанциям от старых к новым."""

    __tablename__ = "payments"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    apartment_id: Mapped[int] = mapped_column(
        ForeignKey("apartments.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(MONEY)
    paid_at: Mapped[datetime] = mapped_column(index=True)
    method: Mapped[PaymentMethod] = mapped_column(str_enum(PaymentMethod))
    # Номер платёжки / ID транзакции: защищает от двойного учёта при повторном импорте.
    reference: Mapped[str | None] = mapped_column(String(128), unique=True)
    comment: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    apartment: Mapped[Apartment] = relationship()
