"""Расчёт строк квитанции по лицевому счёту за период.

Правила для коммунальных услуг по счётчикам — по мотивам ПП РФ № 354:

* есть показания в периоде — начисляем по факту от последних учтённых показаний;
  если до этого начисляли «по среднему»/«по нормативу», добавляем строку перерасчёта,
  снимающую ровно те суммы;
* показаний нет — по среднемесячному расходу (история не короче 3 месяцев
  в окне 6 месяцев), но не дольше 3 периодов подряд;
* иначе — по нормативу на число проживающих; так же считаем, если счётчика нет.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import periods
from app.billing.models import (
    ESTIMATED_BASES,
    CalculationBasis,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Tariff,
    TariffMethod,
)
from app.housing.models import Apartment
from app.meters.models import Meter, MeterReading

AVERAGE_WINDOW_MONTHS = 6
AVERAGE_MIN_SPAN_DAYS = 90
AVERAGE_MAX_PERIODS = 3

_KOPECK = Decimal("0.01")
_QTY = Decimal("0.001")
_RATE = Decimal("0.0001")


def money(value: Decimal) -> Decimal:
    return value.quantize(_KOPECK, rounding=ROUND_HALF_UP)


def qty(value: Decimal) -> Decimal:
    return value.quantize(_QTY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class LineDraft:
    service_name: str
    unit: str
    quantity: Decimal
    rate: Decimal
    amount: Decimal
    basis: CalculationBasis
    tariff_id: int | None
    meter_id: int | None = None
    reading_from: Decimal | None = None
    reading_to: Decimal | None = None
    details: str | None = None

    def to_model(self) -> InvoiceLine:
        return InvoiceLine(
            service_name=self.service_name,
            unit=self.unit,
            quantity=self.quantity,
            rate=self.rate,
            amount=self.amount,
            basis=self.basis,
            tariff_id=self.tariff_id,
            meter_id=self.meter_id,
            reading_from=self.reading_from,
            reading_to=self.reading_to,
            details=self.details,
        )


def _line(
    tariff: Tariff,
    quantity: Decimal,
    basis: CalculationBasis,
    *,
    name: str | None = None,
    **extra: object,
) -> LineDraft:
    quantity = qty(quantity)
    return LineDraft(
        service_name=name or tariff.name,
        unit=tariff.unit,
        quantity=quantity,
        rate=tariff.rate,
        amount=money(quantity * tariff.rate),
        basis=basis,
        tariff_id=tariff.id,
        **extra,  # type: ignore[arg-type]
    )


class InvoiceCalculator:
    def __init__(self, session: AsyncSession, period: date, tz: ZoneInfo) -> None:
        self.session = session
        self.period = periods.first_day(period)
        self.start, self.end = periods.bounds(self.period, tz)
        self.tz = tz

    async def calculate(
        self, apartment: Apartment, tariffs: list[Tariff], meters: list[Meter]
    ) -> list[LineDraft]:
        lines: list[LineDraft] = []
        for tariff in tariffs:
            match tariff.method:
                case TariffMethod.PER_AREA:
                    lines.append(_line(tariff, apartment.area, CalculationBasis.TARIFF))
                case TariffMethod.PER_RESIDENT:
                    if apartment.residents_count > 0:
                        lines.append(
                            _line(
                                tariff,
                                Decimal(apartment.residents_count),
                                CalculationBasis.TARIFF,
                            )
                        )
                case TariffMethod.FIXED:
                    lines.append(_line(tariff, Decimal(1), CalculationBasis.TARIFF))
                case TariffMethod.METERED:
                    lines.extend(await self._metered(apartment, tariff, meters))
        return lines

    async def _metered(
        self, apartment: Apartment, tariff: Tariff, meters: list[Meter]
    ) -> list[LineDraft]:
        own = [m for m in meters if m.kind == tariff.meter_kind and m.is_active]
        if not own:
            normative = self._normative(apartment, tariff)
            if normative is None:
                return []
            return [
                _line(
                    tariff,
                    normative,
                    CalculationBasis.NORMATIVE,
                    details=f"нет прибора учёта: норматив × {apartment.residents_count} чел.",
                )
            ]
        result: list[LineDraft] = []
        for meter in own:
            result.extend(await self._meter_lines(apartment, tariff, meter))
        return result

    @staticmethod
    def _normative(apartment: Apartment, tariff: Tariff) -> Decimal | None:
        if tariff.normative is None or apartment.residents_count == 0:
            return None
        return tariff.normative * apartment.residents_count

    async def _meter_lines(
        self, apartment: Apartment, tariff: Tariff, meter: Meter
    ) -> list[LineDraft]:
        name = f"{tariff.name} (сч. № {meter.serial_number})"
        history = await self._billing_history(meter)

        current = await self.session.scalar(
            select(MeterReading)
            .where(
                MeterReading.meter_id == meter.id,
                MeterReading.taken_at >= self.start,
                MeterReading.taken_at < self.end,
            )
            .order_by(MeterReading.taken_at.desc())
            .limit(1)
        )
        if current is not None:
            return self._actual_lines(tariff, meter, name, current.value, history)

        average = await self._average_consumption(meter)
        if average is not None and history.average_periods < AVERAGE_MAX_PERIODS:
            return [
                _line(
                    tariff,
                    average,
                    CalculationBasis.AVERAGE,
                    name=name,
                    meter_id=meter.id,
                    details="показания не переданы: по среднемесячному расходу",
                )
            ]
        normative = self._normative(apartment, tariff)
        if normative is None:
            return []
        return [
            _line(
                tariff,
                normative,
                CalculationBasis.NORMATIVE,
                name=name,
                meter_id=meter.id,
                details=f"показания не переданы: норматив × {apartment.residents_count} чел.",
            )
        ]

    def _actual_lines(
        self,
        tariff: Tariff,
        meter: Meter,
        name: str,
        current_value: Decimal,
        history: "_MeterBillingHistory",
    ) -> list[LineDraft]:
        start_value = (
            history.billed_up_to if history.billed_up_to is not None else meter.initial_value
        )
        lines = [
            _line(
                tariff,
                current_value - start_value,
                CalculationBasis.METER,
                name=name,
                meter_id=meter.id,
                reading_from=start_value,
                reading_to=current_value,
            )
        ]
        if history.estimated_quantity:
            # Снимаем ровно ранее начисленные суммы — даже если тариф с тех пор изменился.
            quantity = -qty(history.estimated_quantity)
            amount = -money(history.estimated_amount)
            lines.append(
                LineDraft(
                    service_name=f"Перерасчёт: {name}",
                    unit=tariff.unit,
                    quantity=quantity,
                    rate=(amount / quantity).quantize(_RATE, rounding=ROUND_HALF_UP),
                    amount=amount,
                    basis=CalculationBasis.RECALCULATION,
                    tariff_id=tariff.id,
                    meter_id=meter.id,
                    details=(
                        f"снято начисленное без показаний за {history.estimated_periods} мес."
                    ),
                )
            )
        return lines

    async def _billing_history(self, meter: Meter) -> "_MeterBillingHistory":
        rows = (
            await self.session.execute(
                select(
                    InvoiceLine.basis,
                    InvoiceLine.quantity,
                    InvoiceLine.amount,
                    InvoiceLine.reading_to,
                )
                .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                .where(
                    InvoiceLine.meter_id == meter.id,
                    Invoice.status != InvoiceStatus.CANCELLED,
                    Invoice.period < self.period,
                )
                .order_by(Invoice.period.desc(), InvoiceLine.id.desc())
            )
        ).all()

        history = _MeterBillingHistory()
        for basis, quantity, amount, reading_to in rows:
            if basis == CalculationBasis.METER:
                history.billed_up_to = reading_to
                break
            if basis in ESTIMATED_BASES:
                history.estimated_quantity += quantity
                history.estimated_amount += amount
                history.estimated_periods += 1
            if basis == CalculationBasis.AVERAGE:
                history.average_periods += 1
        return history

    async def _average_consumption(self, meter: Meter) -> Decimal | None:
        window_start = periods.bounds(
            periods.add_months(self.period, -AVERAGE_WINDOW_MONTHS), self.tz
        )[0]
        first_last = (
            await self.session.execute(
                select(
                    func.min(MeterReading.taken_at),
                    func.max(MeterReading.taken_at),
                ).where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.taken_at >= window_start,
                    MeterReading.taken_at < self.start,
                )
            )
        ).one()
        first_at, last_at = first_last
        if first_at is None or (last_at - first_at).days < AVERAGE_MIN_SPAN_DAYS:
            return None
        values = dict(
            (
                await self.session.execute(
                    select(MeterReading.taken_at, MeterReading.value).where(
                        MeterReading.meter_id == meter.id,
                        MeterReading.taken_at.in_([first_at, last_at]),
                    )
                )
            ).all()
        )
        span_days = Decimal((last_at - first_at).total_seconds()) / Decimal(86400)
        per_day = (values[last_at] - values[first_at]) / span_days
        return per_day * periods.days_in(self.period)


@dataclass(slots=True)
class _MeterBillingHistory:
    # Показание, до которого уже начислено по факту (None — начислений по факту не было).
    billed_up_to: Decimal | None = None
    # Начислено без показаний после последнего фактического начисления.
    estimated_quantity: Decimal = Decimal(0)
    estimated_amount: Decimal = Decimal(0)
    estimated_periods: int = 0
    # Сколько периодов после последних показаний уже начислено «по среднему».
    average_periods: int = 0
