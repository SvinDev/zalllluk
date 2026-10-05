from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from app.billing.models import (
    CalculationBasis,
    InvoiceStatus,
    PaymentMethod,
    TariffMethod,
)
from app.billing.periods import Period
from app.core.config import get_settings
from app.core.schemas import Schema
from app.housing.schemas import ApartmentBrief, ApartmentRead
from app.meters.models import MeterKind

Rate = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=4)]
Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]


# ---------- Тарифы ----------


class TariffCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    method: TariffMethod
    meter_kind: MeterKind | None = None
    rate: Rate
    normative: Rate | None = Field(
        default=None, description="Норматив потребления на 1 человека в месяц"
    )
    building_id: int | None = Field(default=None, description="Пусто — для всех домов")
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "TariffCreate":
        if self.method == TariffMethod.METERED and self.meter_kind is None:
            raise ValueError("Для услуги по счётчику укажите тип счётчика")
        if self.method != TariffMethod.METERED and self.meter_kind is not None:
            raise ValueError("Тип счётчика указывается только для услуг по счётчику")
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("Дата окончания раньше даты начала действия")
        return self


class TariffUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)] | None = None
    rate: Rate | None = None
    normative: Rate | None = None
    valid_to: date | None = None


class TariffRead(Schema):
    id: int
    name: str
    method: TariffMethod
    meter_kind: MeterKind | None
    unit: str
    rate: Decimal
    normative: Decimal | None
    building_id: int | None
    valid_from: date
    valid_to: date | None


# ---------- Квитанции ----------


class InvoiceLineRead(Schema):
    id: int
    service_name: str
    unit: str
    quantity: Decimal
    rate: Decimal
    amount: Decimal
    basis: CalculationBasis
    meter_id: int | None
    reading_from: Decimal | None
    reading_to: Decimal | None
    details: str | None


class InvoiceRead(Schema):
    id: int
    number: str
    apartment: ApartmentBrief
    period: date
    status: InvoiceStatus
    amount: Decimal
    opening_balance: Decimal
    total_due: Decimal
    paid_amount: Decimal
    due_date: date | None
    issued_at: datetime | None
    created_at: datetime


class Payee(BaseModel):
    name: str
    inn: str
    kpp: str
    bank_name: str
    bik: str
    bank_account: str
    corr_account: str
    address: str
    phone: str


def _company_payee() -> Payee:
    return Payee(**get_settings().company.model_dump())


class InvoiceDetail(InvoiceRead):
    apartment: ApartmentRead  # type: ignore[assignment]  # для печати нужны площадь и жильцы
    lines: list[InvoiceLineRead]
    payee: Payee = Field(default_factory=_company_payee)
    payment_qr: str | None = Field(
        default=None, description="Строка для QR-кода оплаты по ГОСТ Р 56042-2014"
    )


class BillingRunRequest(BaseModel):
    period: Period
    building_id: int | None = None


class BillingRunReport(BaseModel):
    period: date
    created: int
    regenerated: int
    skipped_posted: int = Field(description="Уже выставлены — не пересчитываются")
    without_charges: int = Field(description="Нет применимых тарифов")
    total_amount: Decimal


class IssueRequest(BaseModel):
    period: Period
    building_id: int | None = None


class IssueReport(BaseModel):
    issued: int


# ---------- Оплаты ----------


class PaymentCreate(BaseModel):
    apartment_id: int | None = None
    account_number: str | None = Field(default=None, max_length=32)
    amount: Money
    paid_at: AwareDatetime | None = None
    method: PaymentMethod = PaymentMethod.BANK
    reference: Annotated[str, Field(max_length=128)] | None = None
    comment: Annotated[str, Field(max_length=1000)] | None = None

    @model_validator(mode="after")
    def _account(self) -> "PaymentCreate":
        if (self.apartment_id is None) == (self.account_number is None):
            raise ValueError("Укажите либо apartment_id, либо account_number")
        return self


class PaymentRead(Schema):
    id: int
    apartment: ApartmentBrief
    amount: Decimal
    paid_at: datetime
    method: PaymentMethod
    reference: str | None
    comment: str | None
    created_at: datetime


class AccountSummary(BaseModel):
    apartment_id: int
    charged: Decimal
    paid: Decimal
    balance: Decimal = Field(description="Долг (+) или переплата (−)")
    last_payment_at: datetime | None


class DebtorRow(BaseModel):
    apartment: ApartmentBrief
    owner_name: str | None
    balance: Decimal
    last_payment_at: datetime | None
