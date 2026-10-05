from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from app.core.schemas import Schema
from app.housing.schemas import ApartmentBrief
from app.meters.models import MeterKind, ReadingSource

ReadingValue = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]
SerialNumber = Annotated[str, Field(min_length=1, max_length=64)]
ExternalId = Annotated[str, Field(min_length=1, max_length=128)]


class MeterCreate(BaseModel):
    apartment_id: int
    kind: MeterKind
    serial_number: SerialNumber
    external_id: ExternalId | None = None
    installed_at: date | None = None
    verification_due: date | None = None
    initial_value: ReadingValue = Decimal(0)


class MeterUpdate(BaseModel):
    serial_number: SerialNumber | None = None
    external_id: ExternalId | None = None
    installed_at: date | None = None
    verification_due: date | None = None
    is_active: bool | None = None


class LastReading(Schema):
    value: Decimal
    taken_at: datetime
    source: ReadingSource


class MeterRead(Schema):
    id: int
    apartment_id: int
    apartment: ApartmentBrief
    kind: MeterKind
    unit: str
    serial_number: str
    external_id: str | None
    installed_at: date | None
    verification_due: date | None
    initial_value: Decimal
    is_active: bool
    last_reading: LastReading | None = None


class ReadingCreate(BaseModel):
    value: ReadingValue
    taken_at: AwareDatetime | None = Field(
        default=None,
        description="Момент снятия показаний (только для сотрудников УК); по умолчанию — сейчас",
    )


class ReadingRead(Schema):
    id: int
    meter_id: int
    value: Decimal
    taken_at: datetime
    source: ReadingSource
    submitted_by_id: int | None
    created_at: datetime
    consumption: Decimal | None = Field(
        default=None, description="Расход относительно предыдущего показания"
    )


class MeterBrief(Schema):
    id: int
    kind: MeterKind
    unit: str
    serial_number: str
    apartment: ApartmentBrief


class ReadingJournalItem(ReadingRead):
    meter: MeterBrief


class ExternalReading(BaseModel):
    """Показание из внешней системы: прибор определяется по серийному номеру или external_id."""

    serial_number: SerialNumber | None = None
    external_id: ExternalId | None = None
    value: ReadingValue
    taken_at: AwareDatetime

    @model_validator(mode="after")
    def _meter_reference(self) -> "ExternalReading":
        if not self.serial_number and not self.external_id:
            raise ValueError("Нужно указать serial_number или external_id прибора")
        return self


class IngestError(BaseModel):
    index: int
    serial_number: str | None
    external_id: str | None
    error: str


class IngestReport(BaseModel):
    received: int
    accepted: int
    duplicates: int
    rejected: list[IngestError]
