from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin
from app.housing.models import Building


class Announcement(TimestampMixin, Base):
    """Объявление для жителей: всем домам (building_id = NULL) или одному дому."""

    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    building_id: Mapped[int | None] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True
    )
    is_pinned: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Можно запланировать публикацию на будущее.
    published_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    building: Mapped[Building | None] = relationship()
