from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .db import Base, engine
from .routers import auth, driver, ops

STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Alembic migrations replace this once the schema settles.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Taxi Dispatch Platform", version="0.1.0", lifespan=lifespan)

# The Android app runs from https://localhost and uses bearer tokens, not cookies,
# so allowing any origin is safe here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-Ops-Key"],
)

app.include_router(auth.router)
app.include_router(driver.router)
app.include_router(ops.router)


@app.get("/health")
def health():
    return {"ok": True}


# Driver screens in a phone browser, for trying the app without installing it.
# (Background tracking needs the Android app.)
if (STATIC / "driver").exists():
    app.mount("/driver", StaticFiles(directory=STATIC / "driver", html=True), name="driver")


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/driver/")


@app.get("/ops", include_in_schema=False)
def ops_map():
    return FileResponse(STATIC / "ops.html")
