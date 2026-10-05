from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from app.core.schemas import Schema
from app.users.models import UserRole


def _lower(value: str) -> str:
    return value.strip().lower()


Email = Annotated[EmailStr, AfterValidator(_lower)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
Phone = Annotated[str, Field(max_length=32, pattern=r"^[\d\s()+-]+$")]


class UserBrief(Schema):
    id: int
    full_name: str
    email: str
    phone: str | None


class UserRead(UserBrief):
    role: UserRole
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    email: Email
    full_name: Annotated[str, Field(min_length=1, max_length=255)]
    phone: Phone | None = None
    role: UserRole = UserRole.RESIDENT
    password: Password


class UserUpdate(BaseModel):
    full_name: Annotated[str, Field(min_length=1, max_length=255)] | None = None
    phone: Phone | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: Password | None = None
