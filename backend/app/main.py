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

@app.middleware("http")
async def no_stale_pages(request, call_next):
    """Hashed asset files can be cached forever; the page that loads them must not be."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/driver") and "/assets/" not in path or path == "/ops":
        response.headers["Cache-Control"] = "no-cache"
    elif "/assets/" in path:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


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
