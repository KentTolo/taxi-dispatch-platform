from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..models import AVAILABLE, OFFLINE, ON_BREAK, Driver, DriverLocation, Shift, Vehicle
from ..security import current_driver

router = APIRouter(prefix="/api/driver", tags=["driver"])

MAX_POINT_AGE = timedelta(hours=12)  # queued offline points older than this are dropped
MAX_CLOCK_SKEW = timedelta(minutes=5)


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)
    speed: float | None = None
    heading: float | None = None
    time: int  # milliseconds since the Unix epoch, as the phone recorded it


class LocationBatch(BaseModel):
    points: list[Point] = Field(min_length=1, max_length=500)
    battery: int | None = Field(default=None, ge=0, le=100)


class ShiftStart(BaseModel):
    vehicle_id: int | None = None


class StatusChange(BaseModel):
    status: str


def _driver_view(d: Driver) -> dict:
    shift = d.current_shift
    return {
        "id": d.id,
        "name": d.name,
        "phone": d.phone,
        "status": d.status,
        "shift": None
        if shift is None
        else {
            "id": shift.id,
            "started_at": shift.started_at.isoformat() + "Z",
            "vehicle": None
            if shift.vehicle is None
            else {"id": shift.vehicle.id, "plate": shift.vehicle.plate},
            "points": shift.points_count,
        },
        "position_at": d.position_at.isoformat() + "Z" if d.position_at else None,
    }


@router.get("/me")
def me(driver: Driver = Depends(current_driver)):
    return _driver_view(driver)


@router.get("/vehicles")
def vehicles(driver: Driver = Depends(current_driver), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Vehicle).where(Vehicle.company_id == driver.company_id, Vehicle.active).order_by(Vehicle.plate)
    ).all()
    return [{"id": v.id, "plate": v.plate, "label": " ".join(filter(None, [v.colour, v.make, v.model]))} for v in rows]


@router.post("/shift/start")
def start_shift(body: ShiftStart, driver: Driver = Depends(current_driver), db: Session = Depends(get_db)):
    if driver.current_shift_id is None:
        if body.vehicle_id is not None:
            vehicle = db.get(Vehicle, body.vehicle_id)
            if vehicle is None or vehicle.company_id != driver.company_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown vehicle")
        shift = Shift(company_id=driver.company_id, driver_id=driver.id, vehicle_id=body.vehicle_id)
        db.add(shift)
        db.flush()
        driver.current_shift_id = shift.id
    driver.status = AVAILABLE
    db.commit()
    db.refresh(driver)
    return _driver_view(driver)


@router.post("/shift/end")
def end_shift(driver: Driver = Depends(current_driver), db: Session = Depends(get_db)):
    shift = driver.current_shift
    summary = None
    if shift is not None:
        shift.ended_at = utcnow()
        summary = {
            "started_at": shift.started_at.isoformat() + "Z",
            "ended_at": shift.ended_at.isoformat() + "Z",
            "hours": round((shift.ended_at - shift.started_at).total_seconds() / 3600, 2),
            "points": shift.points_count,
        }
    driver.current_shift_id = None
    driver.status = OFFLINE
    db.commit()
    return {"summary": summary, "driver": _driver_view(driver)}


@router.post("/status")
def set_status(body: StatusChange, driver: Driver = Depends(current_driver), db: Session = Depends(get_db)):
    if body.status not in {AVAILABLE, ON_BREAK}:
        raise HTTPException(422, "Status must be available or on_break")
    if driver.current_shift_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start a shift first")
    driver.status = body.status
    db.commit()
    return _driver_view(driver)


@router.post("/locations")
def upload_locations(
    body: LocationBatch, driver: Driver = Depends(current_driver), db: Session = Depends(get_db)
):
    """Accepts a batch of positions. The app queues points while offline and sends them later."""
    if driver.current_shift_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No active shift")
    now = utcnow()
    accepted = 0
    latest: tuple[datetime, Point] | None = None
    for p in sorted(body.points, key=lambda p: p.time):
        recorded = datetime.fromtimestamp(p.time / 1000, UTC).replace(tzinfo=None)
        if recorded < now - MAX_POINT_AGE or recorded > now + MAX_CLOCK_SKEW:
            continue
        db.add(
            DriverLocation(
                company_id=driver.company_id,
                driver_id=driver.id,
                shift_id=driver.current_shift_id,
                lat=p.lat,
                lng=p.lng,
                accuracy_m=p.accuracy,
                speed_ms=p.speed,
                heading=p.heading,
                recorded_at=recorded,
                received_at=now,
            )
        )
        accepted += 1
        latest = (recorded, p)

    if latest and (driver.position_at is None or latest[0] >= driver.position_at):
        recorded, p = latest
        driver.lat, driver.lng = p.lat, p.lng
        driver.accuracy_m, driver.speed_ms, driver.heading = p.accuracy, p.speed, p.heading
        driver.position_at = min(recorded, now)
    if body.battery is not None:
        driver.battery = body.battery
    if driver.current_shift is not None:
        driver.current_shift.points_count += accepted
    db.commit()
    # The app uses "status" to stay in sync if an operator changes it.
    return {"accepted": accepted, "dropped": len(body.points) - accepted, "status": driver.status}
