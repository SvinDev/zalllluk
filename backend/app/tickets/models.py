from datetime import UTC, datetime, timedelta
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, str_enum
from app.housing.models import Apartment, Building
from app.users.models import User


class TicketCategory(StrEnum):
    PLUMBING = "plumbing"
    ELECTRICITY = "electricity"
    HEATING = "heating"
    ELEVATOR = "elevator"
    CLEANING = "cleaning"
    TERRITORY = "territory"
    INTERCOM = "intercom"
    COMPLAINT = "complaint"
    OTHER = "other"


class TicketPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    EMERGENCY = "emergency"


# Нормативный срок реакции по приоритету (SLA).
TICKET_SLA: dict[TicketPriority, timedelta] = {
    TicketPriority.EMERGENCY: timedelta(hours=2),
    TicketPriority.HIGH: timedelta(hours=24),
    TicketPriority.NORMAL: timedelta(days=3),
    TicketPriority.LOW: timedelta(days=7),
}


class TicketStatus(StrEnum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"  # ждём жителя, доступ в квартиру, материалы
    RESOLVED = "resolved"  # УК считает выполненной, ждём подтверждения жителя
    CLOSED = "closed"
    REJECTED = "rejected"


OPEN_STATUSES = (TicketStatus.NEW, TicketStatus.IN_PROGRESS, TicketStatus.WAITING)


class Ticket(TimestampMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="RESTRICT"), index=True
    )
    apartment_id: Mapped[int | None] = mapped_column(
        ForeignKey("apartments.id", ondelete="SET NULL"), index=True
    )
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    category: Mapped[TicketCategory] = mapped_column(str_enum(TicketCategory))
    priority: Mapped[TicketPriority] = mapped_column(str_enum(TicketPriority))
    status: Mapped[TicketStatus] = mapped_column(
        str_enum(TicketStatus), default=TicketStatus.NEW, index=True
    )
    subject: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    due_at: Mapped[datetime]
    resolved_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]
    rating: Mapped[int | None]
    rating_comment: Mapped[str | None] = mapped_column(Text)

    building: Mapped[Building] = relationship()
    apartment: Mapped[Apartment | None] = relationship()
    author: Mapped[User | None] = relationship(foreign_keys=[author_id])
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    comments: Mapped[list["TicketComment"]] = relationship(
        back_populates="ticket",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TicketComment.id",
    )

    @property
    def is_overdue(self) -> bool:
        return self.status in OPEN_STATUSES and self.due_at < datetime.now(UTC)


class TicketComment(Base):
    __tablename__ = "ticket_comments"
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    # Внутренние комментарии видят только сотрудники УК.
    is_internal: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Системные записи: смена статуса, назначение исполнителя.
    is_system: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    ticket: Mapped[Ticket] = relationship(back_populates="comments")
    author: Mapped[User | None] = relationship()
