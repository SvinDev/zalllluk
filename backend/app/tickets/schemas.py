from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.core.schemas import Schema
from app.housing.schemas import BuildingBrief
from app.tickets.models import TicketCategory, TicketPriority, TicketStatus
from app.users.schemas import UserBrief

Subject = Annotated[str, Field(min_length=3, max_length=255)]
Body = Annotated[str, Field(min_length=1, max_length=10000)]


class TicketCreate(BaseModel):
    apartment_id: int | None = Field(default=None, description="Для жителя обязательно")
    building_id: int | None = Field(
        default=None, description="Для общедомовых заявок без помещения (только сотрудники)"
    )
    category: TicketCategory
    priority: TicketPriority = TicketPriority.NORMAL
    subject: Subject
    description: Body


class TicketUpdate(BaseModel):
    category: TicketCategory | None = None
    priority: TicketPriority | None = None
    subject: Subject | None = None
    assignee_id: int | None = None


class StatusChange(BaseModel):
    status: TicketStatus
    comment: Body | None = None


class CommentCreate(BaseModel):
    body: Body
    is_internal: bool = False


class Rating(BaseModel):
    rating: Annotated[int, Field(ge=1, le=5)]
    comment: Annotated[str, Field(max_length=2000)] | None = None


class ApartmentNumber(Schema):
    id: int
    number: str


class TicketRead(Schema):
    id: int
    building: BuildingBrief
    apartment: ApartmentNumber | None
    author: UserBrief | None
    assignee: UserBrief | None
    category: TicketCategory
    priority: TicketPriority
    status: TicketStatus
    subject: str
    due_at: datetime
    is_overdue: bool
    resolved_at: datetime | None
    closed_at: datetime | None
    rating: int | None
    created_at: datetime
    updated_at: datetime


class CommentRead(Schema):
    id: int
    author: UserBrief | None
    body: str
    is_internal: bool
    is_system: bool
    created_at: datetime


class TicketDetail(TicketRead):
    description: str
    rating_comment: str | None
    comments: list[CommentRead]
