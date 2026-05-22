"""
NSE Platform — FastAPI entry point
====================================
Run with:
    uvicorn api.main:app --reload --host 127.0.0.1 --port 8000

Interactive docs:
    http://127.0.0.1:8000/docs
"""

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Make sure project root is on sys.path regardless of how uvicorn is launched
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import API_PREFIX, CORS_ORIGINS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs the download + processing pipeline on startup, then yields to serve."""
    try:
        from pipeline.startup_sync import run_startup_sync
        import asyncio
        # Run in a thread so it doesn't block the event loop
        await asyncio.get_event_loop().run_in_executor(None, run_startup_sync)
    except Exception as e:
        log.error(f"Startup pipeline error (non-fatal): {e}")
    yield   # app is now running


app = FastAPI(
    title="NSE F&O Platform",
    description="REST API powering the NSE derivatives dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

from api.routes.futures        import futures_router, index_futures_router
from api.routes.options        import options_router, index_options_router
from api.routes.stocks_indexes import stocks_router

# ── CORS — allow the React dev server ─────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(futures_router,       prefix=API_PREFIX)
app.include_router(index_futures_router, prefix=API_PREFIX)
app.include_router(options_router,       prefix=API_PREFIX)
app.include_router(index_options_router, prefix=API_PREFIX)
app.include_router(stocks_router,        prefix=API_PREFIX)

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "message": "NSE Platform API",
        "docs": "/docs",
        "version": "0.1.0",
    }