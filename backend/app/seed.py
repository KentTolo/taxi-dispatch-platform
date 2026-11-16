"""Create a demo company with drivers and vehicles.

    python -m app.seed

Safe to run more than once; existing rows are left alone.
"""

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import Company, Driver, Vehicle

DEMO_COMPANY = {"slug": "demo", "name": "Demo Taxis", "office_phone": "+26622000000"}

DEMO_DRIVERS = [
    ("Thabo Mokoena", "+26658000001"),
    ("Palesa Nthabiseng", "+26658000002"),
    ("Lerato Sefako", "+26658000003"),
    ("Teboho Ramaili", "+26662000004"),
    ("Mpho Letsie", "+26662000005"),
]

DEMO_VEHICLES = [
    ("A 101 BC", "Toyota", "Corolla", "White"),
    ("A 102 BC", "VW", "Polo Vivo", "Silver"),
    ("A 103 BC", "Toyota", "Quantum", "White"),
    ("A 104 BC", "Nissan", "Almera", "Blue"),
    ("A 105 BC", "Honda", "Fit", "Red"),
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        company = db.scalar(select(Company).where(Company.slug == DEMO_COMPANY["slug"]))
        if company is None:
            company = Company(**DEMO_COMPANY)
            db.add(company)
            db.flush()
        for name, phone in DEMO_DRIVERS:
            if not db.scalar(select(Driver).where(Driver.company_id == company.id, Driver.phone == phone)):
                db.add(Driver(company_id=company.id, name=name, phone=phone))
        for plate, make, model, colour in DEMO_VEHICLES:
            if not db.scalar(select(Vehicle).where(Vehicle.company_id == company.id, Vehicle.plate == plate)):
                db.add(Vehicle(company_id=company.id, plate=plate, make=make, model=model, colour=colour))
        db.commit()
    print("Seeded company 'demo' with", len(DEMO_DRIVERS), "drivers")


if __name__ == "__main__":
    seed()
