import asyncio
import os
from contextlib import asynccontextmanager

import logging
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

# CORS: läs tillåtna origins från env. Sätt CORS_ORIGINS i .env för produktion,
# t.ex. "https://skaffio.dindoman.com,http://localhost:3111".
# Bearer-token auth kräver INTE credentials=True (det är för cookies).
# allow_credentials=True + wildcard är spec-violation — tillåt bara med explicita origins.
_cors_raw = os.getenv("CORS_ORIGINS", "")
_CORS_ORIGINS: list = [o.strip() for o in _cors_raw.split(",") if o.strip()]
_CORS_CREDENTIALS = bool(_CORS_ORIGINS)   # True bara när specifika origins är satta
if not _CORS_ORIGINS:
    _CORS_ORIGINS = ["*"]
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import create_db_and_tables
from routes import (
    ai_planner, auth as auth_routes, collections, favorites, freezer, household,
    images, inbox, mealplan, nutrition, pantry, recipes, shopping, tags,
)
from services.backup import backup_loop
from services.daily_report import daily_report_loop
from services.import_queue import import_worker, resume_pending
from services.ratelimit import limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("/data/uploads", exist_ok=True)
    os.makedirs("/data/backups", exist_ok=True)
    create_db_and_tables()
    await resume_pending()
    # Starta daglig backup + morgon-rapport + import-worker i bakgrunden
    backup_task = asyncio.create_task(backup_loop())
    report_task = asyncio.create_task(daily_report_loop())
    queue_task = asyncio.create_task(import_worker())
    yield
    backup_task.cancel()
    report_task.cancel()
    queue_task.cancel()


app = FastAPI(title="Skaffio API", lifespan=lifespan)

# Rate-limit-state + handler för 429-fel
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = exc.body
    logger.error(
        "422 Validation error on %s %s | errors=%s | body=%s",
        request.method, request.url.path, exc.errors(), str(body)[:500],
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=_CORS_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="/data/uploads"), name="uploads")


# Path-prefix-whitelist som INTE kräver inloggning.
PUBLIC_PATH_PREFIXES = (
    "/api/health",
    "/api/auth/",                # register, login, logout, status, cf-login
    "/api/shopping/share/",      # publik delningslänk inköpslista
    "/api/recipes/share/",       # publik delningslänk recept
    "/api/mealplan/ical/",       # publik iCal-feed för kalenderprenumeration
)


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        if not any(path.startswith(p) for p in PUBLIC_PATH_PREFIXES):
            from services.auth import _decode, COOKIE_NAME
            from fastapi.responses import JSONResponse
            # Cookie (HttpOnly) har prioritet — skickas automatiskt av browser
            token = request.cookies.get(COOKIE_NAME)
            if not token:
                authz = request.headers.get("authorization", "")
                if not authz.lower().startswith("bearer "):
                    return JSONResponse({"detail": "Inloggning krävs"}, status_code=401)
                token = authz.split(" ", 1)[1].strip()
            if _decode(token) is None:
                return JSONResponse({"detail": "Ogiltig token"}, status_code=401)
    return await call_next(request)


app.include_router(auth_routes.router, prefix="/api")
app.include_router(household.router, prefix="/api")
app.include_router(recipes.router, prefix="/api")
app.include_router(images.router, prefix="/api")
app.include_router(shopping.router, prefix="/api")
app.include_router(mealplan.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(ai_planner.router, prefix="/api")
app.include_router(freezer.router, prefix="/api")
app.include_router(collections.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(pantry.router, prefix="/api")
app.include_router(inbox.router, prefix="/api")
app.include_router(nutrition.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}


