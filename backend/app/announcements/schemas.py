from datetime import datetime
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field

from app.core.schemas import Schema
from app.housing.schemas import BuildingBrief

Title = Annotated[str, Field(min_length=1, max_length=255)]
Body = Annotated[str, Field(min_length=1, max_length=20000)]


class AnnouncementCreate(BaseModel):
    title: Title
    body: Body
    building_id: int | None = None
    is_pinned: bool = False
    published_at: AwareDatetime | None = None


class AnnouncementUpdate(BaseModel):
    title: Title | None = None
    body: Body | None = None
    is_pinned: bool | None = None
    published_at: AwareDatetime | None = None


class AnnouncementRead(Schema):
    id: int
    title: str
    body: str
    building: BuildingBrief | None
    is_pinned: bool
    published_at: datetime
    created_at: datetime
