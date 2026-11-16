from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..geo import bounding_box, haversine_km
from ..models import AVAILABLE, OFFLINE, Company, Driver, DriverLocation
from ..security import require_ops_key
from ..sms import OUTBOX

router = APIRouter(prefix="/api/ops", tags=["operators"], dependencies=[Depends(require_ops_key)])


def _company(db: Session, slug: str) -> Company:
    company = db.scalar(select(Company).where(Company.slug == slug))
    if company is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown company")
    return company


def _age_s(d: Driver) -> float | None:
    return None if d.position_at is None else max(0.0, (utcnow() - d.position_at).total_seconds())


def _live_view(d: Driver) -> dict:
    age = _age_s(d)
    lost = d.status != OFFLINE and (age is None or age > get_settings().signal_lost_after_s)
    shift = d.current_shift
    return {
        "id": d.id,
        "name": d.name,
        "phone": d.phone,
        "status": d.status,
        "signal_lost": lost,
        "lat": d.lat,
        "lng": d.lng,
        "accuracy_m": d.accuracy_m,
        "speed_kmh": round(d.speed_ms * 3.6, 1) if d.speed_ms is not None else None,
        "heading": d.heading,
        "battery": d.battery,
        "position_age_s": None if age is None else round(age),
        "vehicle": shift.vehicle.plate if shift and shift.vehicle else None,
        "shift_started_at": shift.started_at.isoformat() + "Z" if shift else None,
    }


@router.get("/drivers")
def live_drivers(
    company: str, include_offline: bool = False, db: Session = Depends(get_db)
):
    """Every driver on shift, with their latest position. Polled by the live map."""
    c = _company(db, company)
    q = select(Driver).where(Driver.company_id == c.id, Driver.active)
    if not include_offline:
        q = q.where(Driver.status != OFFLINE)
    drivers = db.scalars(q.order_by(Driver.name)).all()
    return {"server_time": utcnow().isoformat() + "Z", "drivers": [_live_view(d) for d in drivers]}


@router.get("/drivers/nearest")
def nearest_drivers(
    company: str,
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=50),
    limit: int = Query(default=5, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Available drivers with a fresh position, nearest first. This is what dispatch will use."""
    s = get_settings()
    c = _company(db, company)
    radius = radius_km or s.default_radius_km
    min_lat, max_lat, min_lng, max_lng = bounding_box(lat, lng, radius)
    fresh_after = utcnow() - timedelta(seconds=s.signal_lost_after_s)
    candidates = db.scalars(
        select(Driver).where(
            Driver.company_id == c.id,
            Driver.active,
            Driver.status == AVAILABLE,
            Driver.position_at >= fresh_after,
            Driver.lat.between(min_lat, max_lat),
            Driver.lng.between(min_lng, max_lng),
        )
    ).all()
    ranked = sorted(
        ((haversine_km(lat, lng, d.lat, d.lng), d) for d in candidates), key=lambda x: x[0]
    )
    return {
        "radius_km": radius,
        "drivers": [
            {**_live_view(d), "distance_km": round(km, 2)} for km, d in ranked if km <= radius
        ][:limit],
    }


@router.get("/drivers/{driver_id}/trail")
def driver_trail(
    driver_id: int, company: str, minutes: int = Query(default=60, ge=1, le=1440), db: Session = Depends(get_db)
):
    c = _company(db, company)
    d = db.get(Driver, driver_id)
    if d is None or d.company_id != c.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown driver")
    rows = db.scalars(
        select(DriverLocation)
        .where(DriverLocation.driver_id == d.id, DriverLocation.recorded_at >= utcnow() - timedelta(minutes=minutes))
        .order_by(DriverLocation.recorded_at)
    ).all()
    return {"points": [[r.lat, r.lng, r.recorded_at.isoformat() + "Z"] for r in rows]}


@router.get("/sms-outbox")
def sms_outbox():
    """Demo mode: messages that would have been sent by SMS."""
    return list(OUTBOX)
