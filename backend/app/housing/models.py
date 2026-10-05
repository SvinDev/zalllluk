from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin
from app.users.models import User

apartment_residents = Table(
    "apartment_residents",
    Base.metadata,
    Column("apartment_id", ForeignKey("apartments.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)


class Building(TimestampMixin, Base):
    """Многоквартирный дом в управлении."""

    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str] = mapped_column(String(500), unique=True)
    floors: Mapped[int | None]
    entrances: Mapped[int | None]
    year_built: Mapped[int | None]
    notes: Mapped[str | None] = mapped_column(Text)

    apartments: Mapped[list["Apartment"]] = relationship(back_populates="building")


class Apartment(TimestampMixin, Base):
    """Помещение (квартира или нежилое) с лицевым счётом."""

    __tablename__ = "apartments"
    __table_args__ = (
        UniqueConstraint("building_id", "number"),
        CheckConstraint("area > 0", name="area_positive"),
        CheckConstraint("residents_count >= 0", name="residents_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    building_id: Mapped[int] = mapped_column(ForeignKey("buildings.id", ondelete="RESTRICT"))
    number: Mapped[str] = mapped_column(String(20))
    account_number: Mapped[str] = mapped_column(String(32), unique=True)
    area: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    residents_count: Mapped[int] = mapped_column(default=0, server_default="0")
    owner_name: Mapped[str | None] = mapped_column(String(255))

    building: Mapped[Building] = relationship(back_populates="apartments")
    residents: Mapped[list[User]] = relationship(secondary=apartment_residents, order_by=User.id)
