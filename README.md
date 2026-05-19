# NSE Platform

Full-stack NSE derivatives dashboard — FastAPI backend + React frontend.

## Project Structure

```
nse-platform/
├── config.py                  ← ALL paths & settings — edit this first
│
├── api/
│   ├── main.py                ← FastAPI app entry point
│   ├── db.py                  ← DuckDB query layer
│   ├── schemas.py             ← Pydantic response models
│   └── routes/
│       ├── options.py         ← /api/v1/options/*
│       ├── futures.py         ← /api/v1/futures/*
│       └── stocks_indexes.py  ← /api/v1/stocks/*, /api/v1/indexes/*
│
├── pipeline/
│   ├── processor.py           ← options bhav copy processor (ported from original)
│   ├── downloader.py          ← NSE automated download (TODO)
│   └── scheduler.py           ← APScheduler cron job (TODO)
│
├── frontend/                  ← React app (Vite) — built next
│
└── requirements.txt
```

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure your data path

Open `config.py` and set `DATA_ROOT` to your output folder:

```python
DATA_ROOT = Path(r"D:\Your\Path\To\OI Analysis")
```

### 3. Run the API

```bash
# From the project root
uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. Verify

- Health check: http://127.0.0.1:8000/health
- Interactive API docs: http://127.0.0.1:8000/docs
- Example request:
  ```
  GET /api/v1/options/tickers
  GET /api/v1/options/expiries/SBIN
  GET /api/v1/options/dates/SBIN/27Jan2026
  GET /api/v1/options/snapshot/SBIN/27Jan2026/2026-01-01
  GET /api/v1/options/analytics/SBIN/27Jan2026
  GET /api/v1/options/data/SBIN/27Jan2026?start_date=2026-01-01&end_date=2026-01-07
  ```

## Key API Endpoints

### Options
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/options/tickers` | List all option tickers |
| GET | `/api/v1/options/expiries/{ticker}` | List expiries for a ticker |
| GET | `/api/v1/options/dates/{ticker}/{expiry}` | Available trading dates |
| GET | `/api/v1/options/snapshot/{ticker}/{expiry}/{date}` | Single-day strike data (main chart) |
| GET | `/api/v1/options/analytics/{ticker}/{expiry}` | PCR, max pain, underlying time series |
| GET | `/api/v1/options/data/{ticker}/{expiry}?start_date=&end_date=` | Raw OHLC data |

### Futures / Stocks / Indexes
In future updates

## Frontend (next step)

```bash
cd frontend
npm install
npm run dev   # starts on http://localhost:5173
```

React app talks to the FastAPI backend at `http://127.0.0.1:8000`.
