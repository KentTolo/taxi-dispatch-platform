import hashlib
import hmac
import re
import secrets
from datetime import timedelta

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, utcnow
from .models import Driver

_LS_MOBILE = re.compile(r"^[5-6]\d{7}$")


def normalize_ls_phone(raw: str) -> str:
    """Turn '5812 3456', '+266 58123456' or '0026658123456' into '+26658123456'."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00266"):
        digits = digits[5:]
    elif digits.startswith("266") and len(digits) == 11:
        digits = digits[3:]
    if not _LS_MOBILE.match(digits):
        raise HTTPException(422, "Enter an 8-digit Lesotho mobile number")
    return "+266" + digits


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(phone: str, code: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def make_driver_token(driver: Driver) -> str:
    s = get_settings()
    payload = {
        "sub": str(driver.id),
        "cid": driver.company_id,
        "role": "driver",
        "exp": utcnow() + timedelta(days=s.token_days),
    }
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def current_driver(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> Driver:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    try:
        claims = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login expired, please log in again")
    if claims.get("role") != "driver":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a driver account")
    driver = db.get(Driver, int(claims["sub"]))
    if driver is None or not driver.active or driver.company_id != claims.get("cid"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not active")
    return driver


def require_ops_key(x_ops_key: str = Header(default="")) -> None:
    """Temporary guard for operator endpoints until operator logins exist."""
    if not hmac.compare_digest(x_ops_key, get_settings().ops_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Operator key required")
