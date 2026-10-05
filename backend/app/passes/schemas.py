from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.core.schemas import Schema
from app.housing.schemas import ApartmentBrief
from app.passes.models import PassKind
from app.users.schemas import UserBrief

EffectiveStatus = Literal["pending", "active", "rejected", "used", "cancelled", "expired"]


class PassCreate(BaseModel):
    apartment_id: int
    kind: PassKind = PassKind.GUEST
    visitor_name: Annotated[str, Field(max_length=255)] | None = None
    vehicle_plate: Annotated[str, Field(max_length=20)] | None = None
    comment: Annotated[str, Field(max_length=1000)] | None = None
    valid_from: AwareDatetime | None = Field(default=None, description="По умолчанию — сейчас")
    valid_until: AwareDatetime | None = Field(
        default=None, description="По умолчанию — через 24 часа после начала"
    )
    is_one_time: bool = True

    @model_validator(mode="after")
    def _vehicle_needs_plate(self) -> "PassCreate":
        if self.kind == PassKind.VEHICLE and not self.vehicle_plate:
            raise ValueError("Для въезда автомобиля укажите госномер")
        return self


class PassReject(BaseModel):
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class VisitCreate(BaseModel):
    note: Annotated[str, Field(max_length=500)] | None = None


class VisitRead(Schema):
    id: int
    entered_at: datetime
    checked_by: UserBrief | None
    note: str | None


class PassRead(Schema):
    # Статус читается из ORM-свойства effective_status, но собрать схему можно и по имени.
    model_config = ConfigDict(
        from_attributes=True,
        validate_by_name=True,
        validate_by_alias=True,
        json_schema_serialization_defaults_required=True,
    )

    id: int
    code: str
    apartment: ApartmentBrief
    created_by: UserBrief | None
    kind: PassKind
    visitor_name: str | None
    vehicle_plate: str | None
    comment: str | None
    valid_from: datetime
    valid_until: datetime
    is_one_time: bool
    status: EffectiveStatus = Field(validation_alias="effective_status")
    reviewed_at: datetime | None
    reject_reason: str | None
    created_at: datetime


class PassDetail(PassRead):
    visits: list[VisitRead]


class PassCheckResult(PassDetail):
    valid_now: bool
    reason: str | None = Field(default=None, description="Почему пропуск сейчас не действует")
