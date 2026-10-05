from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.schemas import Schema
from app.integrations.models import ProviderKind
from app.meters.schemas import ExternalReading, IngestReport

Name = Annotated[str, Field(min_length=1, max_length=255)]


class ApiKeyCreate(BaseModel):
    name: Name


class ApiKeyRead(Schema):
    id: int
    name: str
    prefix: str
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None


class ApiKeyCreated(ApiKeyRead):
    key: str = Field(description="Полный ключ. Показывается один раз — сохраните его.")


class IngestRequest(BaseModel):
    readings: Annotated[list[ExternalReading], Field(min_length=1, max_length=1000)]


class DataSourceCreate(BaseModel):
    name: Name
    kind: ProviderKind = ProviderKind.HTTP_JSON
    url: HttpUrl
    auth_token: Annotated[str, Field(max_length=1000)] | None = None
    is_active: bool = True


class DataSourceUpdate(BaseModel):
    name: Name | None = None
    url: HttpUrl | None = None
    auth_token: Annotated[str, Field(max_length=1000)] | None = None
    is_active: bool | None = None


class DataSourceRead(Schema):
    id: int
    name: str
    kind: ProviderKind
    url: str
    has_token: bool
    is_active: bool
    cursor: datetime | None
    last_synced_at: datetime | None
    last_status: str | None
    last_error: str | None


class SyncResult(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    source_id: int
    status: Literal["ok", "partial", "error"]
    report: IngestReport | None = None
    error: str | None = None
