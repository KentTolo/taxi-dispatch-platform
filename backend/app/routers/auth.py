from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..models import Company, Driver, OtpCode
from ..security import hash_code, make_driver_token, new_code, normalize_ls_phone
from ..sms import send_sms

router = APIRouter(prefix="/api/auth/driver", tags=["driver auth"])


class CodeRequest(BaseModel):
    company: str  # company slug, e.g. "urbantaxis"
    phone: str


class VerifyRequest(CodeRequest):
    code: str


def _company(db: Session, slug: str) -> Company:
    company = db.scalar(select(Company).where(Company.slug == slug.strip().lower()))
    if company is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown company code")
    return company


@router.post("/request-code")
def request_code(body: CodeRequest, db: Session = Depends(get_db)):
    s = get_settings()
    company = _company(db, body.company)
    phone = normalize_ls_phone(body.phone)
    driver = db.scalar(
        select(Driver).where(Driver.company_id == company.id, Driver.phone == phone, Driver.active)
    )
    if driver is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This number isn't registered as a driver")

    recent = db.scalars(
        select(OtpCode).where(
            OtpCode.company_id == company.id,
            OtpCode.phone == phone,
            OtpCode.expires_at > utcnow() - timedelta(hours=1),
        )
    ).all()
    if len(recent) >= 3 and not s.demo_mode:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes requested. Try again later.")

    # Older codes for this number stop working once a new one is issued.
    db.execute(
        update(OtpCode)
        .where(OtpCode.company_id == company.id, OtpCode.phone == phone, ~OtpCode.used)
        .values(used=True)
    )
    code = new_code()
    db.add(
        OtpCode(
            company_id=company.id,
            phone=phone,
            code_hash=hash_code(phone, code),
            expires_at=utcnow() + timedelta(seconds=s.otp_ttl_s),
        )
    )
    db.commit()
    send_sms(phone, f"Your {company.name} driver code is {code}. It expires in 5 minutes.")
    response = {"sent_to": phone}
    if s.demo_mode:
        response["demo_code"] = code
    return response


@router.post("/verify")
def verify(body: VerifyRequest, db: Session = Depends(get_db)):
    s = get_settings()
    company = _company(db, body.company)
    phone = normalize_ls_phone(body.phone)
    otp = db.scalar(
        select(OtpCode)
        .where(OtpCode.company_id == company.id, OtpCode.phone == phone, ~OtpCode.used)
        .order_by(OtpCode.id.desc())
    )
    if otp is None or otp.expires_at < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired. Request a new one.")
    otp.attempts += 1
    if otp.attempts > s.otp_max_attempts:
        otp.used = True
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Too many wrong tries. Request a new code.")
    if otp.code_hash != hash_code(phone, body.code.strip()):
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Wrong code")
    otp.used = True
    driver = db.scalar(select(Driver).where(Driver.company_id == company.id, Driver.phone == phone))
    db.commit()
    return {
        "token": make_driver_token(driver),
        "driver": {"id": driver.id, "name": driver.name, "phone": driver.phone},
        "company": {"slug": company.slug, "name": company.name, "office_phone": company.office_phone},
    }
