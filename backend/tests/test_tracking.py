import os
import time

os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["DEMO_MODE"] = "true"
os.environ["OPS_KEY"] = "test-ops"

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app
from app.seed import seed

OPS = {"X-Ops-Key": "test-ops"}
MASERU = (-29.3100, 27.4800)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    seed()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client, phone="58000001"):
    r = client.post("/api/auth/driver/request-code", json={"company": "demo", "phone": phone})
    assert r.status_code == 200, r.text
    code = r.json()["demo_code"]
    r = client.post("/api/auth/driver/verify", json={"company": "demo", "phone": phone, "code": code})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def point(lat, lng, seconds_ago=0):
    return {"lat": lat, "lng": lng, "accuracy": 8, "time": int((time.time() - seconds_ago) * 1000)}


def test_phone_formats_and_unknown_driver(client):
    for phone in ["5800 0001", "+266 58000001", "0026658000001"]:
        r = client.post("/api/auth/driver/request-code", json={"company": "demo", "phone": phone})
        assert r.json()["sent_to"] == "+26658000001"
    assert client.post("/api/auth/driver/request-code", json={"company": "demo", "phone": "58999999"}).status_code == 404
    assert client.post("/api/auth/driver/request-code", json={"company": "demo", "phone": "1234"}).status_code == 422


def test_wrong_code_is_limited(client):
    client.post("/api/auth/driver/request-code", json={"company": "demo", "phone": "58000001"})
    for _ in range(3):
        r = client.post("/api/auth/driver/verify", json={"company": "demo", "phone": "58000001", "code": "000000"})
        assert r.status_code == 400
    r = client.post("/api/auth/driver/verify", json={"company": "demo", "phone": "58000001", "code": "000000"})
    assert "Too many" in r.json()["detail"]


def test_locations_need_a_shift(client):
    h = login(client)
    r = client.post("/api/driver/locations", json={"points": [point(*MASERU)]}, headers=h)
    assert r.status_code == 409


def test_shift_tracking_and_live_map(client):
    h = login(client)
    vehicle = client.get("/api/driver/vehicles", headers=h).json()[0]
    r = client.post("/api/driver/shift/start", json={"vehicle_id": vehicle["id"]}, headers=h)
    assert r.json()["status"] == "available"

    # Out-of-order batch from the offline queue; one point too old to keep.
    batch = [point(-29.311, 27.481, 5), point(-29.312, 27.482, 0), point(-29.30, 27.47, 60 * 60 * 13)]
    r = client.post("/api/driver/locations", json={"points": batch, "battery": 77}, headers=h)
    assert r.json() == {"accepted": 2, "dropped": 1, "status": "available"}

    live = client.get("/api/ops/drivers?company=demo", headers=OPS).json()["drivers"]
    assert len(live) == 1
    d = live[0]
    assert (d["lat"], d["lng"]) == (-29.312, 27.482)  # newest point wins
    assert d["battery"] == 77 and d["vehicle"] == vehicle["plate"] and not d["signal_lost"]

    trail = client.get(f"/api/ops/drivers/{d['id']}/trail?company=demo", headers=OPS).json()["points"]
    assert len(trail) == 2

    r = client.post("/api/driver/shift/end", headers=h)
    assert r.json()["summary"]["points"] == 2
    assert client.get("/api/ops/drivers?company=demo", headers=OPS).json()["drivers"] == []


def test_nearest_ranks_available_fresh_drivers(client):
    positions = {
        "58000001": (-29.3110, 27.4810),  # ~0.15 km from pickup
        "58000002": (-29.3300, 27.5000),  # ~2.9 km
        "58000003": (-29.4500, 27.7000),  # ~26 km, outside 8 km radius
        "62000004": (-29.3105, 27.4805),  # nearest, but on break
    }
    for phone, (lat, lng) in positions.items():
        h = login(client, phone)
        client.post("/api/driver/shift/start", json={}, headers=h)
        client.post("/api/driver/locations", json={"points": [point(lat, lng)]}, headers=h)
        if phone == "62000004":
            client.post("/api/driver/status", json={"status": "on_break"}, headers=h)

    # Driver 5 is on shift but last reported 5 minutes ago: stale, so not offered work.
    h = login(client, "62000005")
    client.post("/api/driver/shift/start", json={}, headers=h)
    client.post("/api/driver/locations", json={"points": [point(-29.3101, 27.4801, 300)]}, headers=h)

    r = client.get("/api/ops/drivers/nearest", params={"company": "demo", "lat": MASERU[0], "lng": MASERU[1]}, headers=OPS)
    names = [d["name"] for d in r.json()["drivers"]]
    assert names == ["Thabo Mokoena", "Palesa Nthabiseng"]

    live = {d["name"]: d for d in client.get("/api/ops/drivers?company=demo", headers=OPS).json()["drivers"]}
    assert live["Mpho Letsie"]["signal_lost"] is True


def test_ops_endpoints_need_key(client):
    assert client.get("/api/ops/drivers?company=demo").status_code == 401
    assert client.get("/api/driver/me").status_code == 401
