"""
NSE Platform — FastAPI entry point (parallel startup sync variant)
====================================================================
Identical to api/main.py except the lifespan hook runs
pipeline.parallel_startup_sync.run_parallel_startup_sync instead of the
sequential pipeline.startup_sync.run_startup_sync.

Run with:
    uvicorn api.main_parallel:app --reload --host 127.0.0.1 --port 8000

Interactive docs:
    http://127.0.0.1:8000/docs
"""

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Make sure project root is on sys.path regardless of how uvicorn is launched
sys.path.insert(0, str(Path(__file__).parent))

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
    """Runs the download + parallel processing pipeline on startup, then yields to serve."""
    try:
        from pipeline.parallel_startup_sync import run_parallel_startup_sync
        import asyncio
        # Run in a thread so it doesn't block the event loop.
        # (run_parallel_startup_sync itself spins up a ProcessPoolExecutor
        # internally per round — that's separate from this executor thread,
        # which only exists to keep the pipeline off the asyncio event loop.)
        await asyncio.get_event_loop().run_in_executor(None, run_parallel_startup_sync)
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
from api.routes                import stocks, participant, market, discovery, fii

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
app.include_router(stocks.router,        prefix=API_PREFIX)
app.include_router(participant.router,   prefix=API_PREFIX)
app.include_router(market.router,        prefix=API_PREFIX)
app.include_router(discovery.router,     prefix=API_PREFIX)
app.include_router(fii.router,           prefix=API_PREFIX)
# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "message": "NSE Platform API (parallel sync)",
        "docs": "/docs",
        "version": "0.1.0",
    }