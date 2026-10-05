from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field

from app.core.schemas import Schema
from app.users.schemas import UserBrief

Address = Annotated[str, Field(min_length=3, max_length=500)]
Area = Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=2)]
ResidentsCount = Annotated[int, Field(ge=0, le=100)]


class BuildingCreate(BaseModel):
    address: Address
    floors: Annotated[int, Field(ge=1, le=200)] | None = None
    entrances: Annotated[int, Field(ge=1, le=100)] | None = None
    year_built: Annotated[int, Field(ge=1800, le=2100)] | None = None
    notes: Annotated[str, Field(max_length=5000)] | None = None


class BuildingUpdate(BaseModel):
    address: Address | None = None
    floors: Annotated[int, Field(ge=1, le=200)] | None = None
    entrances: Annotated[int, Field(ge=1, le=100)] | None = None
    year_built: Annotated[int, Field(ge=1800, le=2100)] | None = None
    notes: Annotated[str, Field(max_length=5000)] | None = None


class BuildingBrief(Schema):
    id: int
    address: str


class BuildingRead(BuildingBrief):
    floors: int | None
    entrances: int | None
    year_built: int | None
    notes: str | None
    apartments_count: int = 0


class ApartmentCreate(BaseModel):
    building_id: int
    number: Annotated[str, Field(min_length=1, max_length=20)]
    account_number: Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[\w-]+$")]
    area: Area
    residents_count: ResidentsCount = 0
    owner_name: Annotated[str, Field(max_length=255)] | None = None


class ApartmentUpdate(BaseModel):
    number: Annotated[str, Field(min_length=1, max_length=20)] | None = None
    account_number: (
        Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[\w-]+$")] | None
    ) = None
    area: Area | None = None
    residents_count: ResidentsCount | None = None
    owner_name: Annotated[str, Field(max_length=255)] | None = None


class ApartmentBrief(Schema):
    id: int
    number: str
    account_number: str
    building: BuildingBrief


class ApartmentRead(Schema):
    id: int
    building_id: int
    building: BuildingBrief
    number: str
    account_number: str
    area: Decimal
    residents_count: int
    owner_name: str | None


class ApartmentDetail(ApartmentRead):
    residents: list[UserBrief]


class ResidentLink(BaseModel):
    user_id: int
