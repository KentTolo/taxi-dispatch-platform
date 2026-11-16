from datetime import datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

# Driver statuses. "offered" and "on_trip" arrive with the dispatch phase.
OFFLINE = "offline"
AVAILABLE = "available"
ON_BREAK = "on_break"
DRIVER_STATUSES = {OFFLINE, AVAILABLE, ON_BREAK}


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    office_phone: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (UniqueConstraint("company_id", "plate"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    plate: Mapped[str] = mapped_column(String(20))
    make: Mapped[str | None] = mapped_column(String(40))
    model: Mapped[str | None] = mapped_column(String(40))
    colour: Mapped[str | None] = mapped_column(String(30))
    active: Mapped[bool] = mapped_column(default=True)


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (UniqueConstraint("company_id", "phone"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20))  # E.164, e.g. +26658123456
    active: Mapped[bool] = mapped_column(default=True)

    status: Mapped[str] = mapped_column(String(20), default=OFFLINE)
    current_shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id", use_alter=True))

    # Latest known position, kept on the row for fast "who is nearby" queries.
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    speed_ms: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    position_at: Mapped[datetime | None] = mapped_column()
    battery: Mapped[int | None] = mapped_column(Integer)

    company: Mapped[Company] = relationship()
    current_shift: Mapped["Shift | None"] = relationship(foreign_keys=[current_shift_id])


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), index=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"))
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column()
    points_count: Mapped[int] = mapped_column(default=0)

    vehicle: Mapped[Vehicle | None] = relationship()


class DriverLocation(Base):
    __tablename__ = "driver_locations"
    __table_args__ = (Index("ix_driver_locations_driver_time", "driver_id", "recorded_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    speed_ms: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column()
    received_at: Mapped[datetime] = mapped_column(default=utcnow)


class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column()
    attempts: Mapped[int] = mapped_column(default=0)
    used: Mapped[bool] = mapped_column(default=False)
