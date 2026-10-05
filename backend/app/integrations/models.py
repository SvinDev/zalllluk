from datetime import datetime
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin, str_enum


class ApiKey(TimestampMixin, Base):
    """Ключ для входящего API (push показаний от АСКУЭ, шлюзов, биллинга партнёров)."""

    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    prefix: Mapped[str] = mapped_column(String(16), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    last_used_at: Mapped[datetime | None]


class ProviderKind(StrEnum):
    HTTP_JSON = "http_json"


class MeterDataSource(TimestampMixin, Base):
    """Внешняя система, у которой показания забираются опросом (pull)."""

    __tablename__ = "meter_data_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[ProviderKind] = mapped_column(str_enum(ProviderKind))
    url: Mapped[str] = mapped_column(String(1000))
    auth_token: Mapped[str | None] = mapped_column(String(1000))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    # Курсор инкрементальной выгрузки: максимальный taken_at, который уже забрали.
    cursor: Mapped[datetime | None]
    last_synced_at: Mapped[datetime | None]
    last_status: Mapped[str | None] = mapped_column(String(32))
    last_error: Mapped[str | None] = mapped_column(Text)

    @property
    def has_token(self) -> bool:
        return bool(self.auth_token)
