"""
NSE Platform — Stocks & Indexes routes  (stubs)
/api/v1/stocks/...
/api/v1/indexes/...
"""

from fastapi import APIRouter
from api.db import list_tickers
from api.schemas import TickerListResponse

stocks_router  = APIRouter(prefix="/stocks",  tags=["stocks"])
indexes_router = APIRouter(prefix="/indexes", tags=["indexes"])


@stocks_router.get("/tickers", response_model=TickerListResponse)
def stock_tickers():
    return TickerListResponse(asset_type="stocks", tickers=list_tickers("stocks"))


@indexes_router.get("/tickers", response_model=TickerListResponse)
def index_tickers():
    return TickerListResponse(asset_type="indexes", tickers=list_tickers("indexes"))

# More endpoints will be added here when the stock / index pipeline is ready.
