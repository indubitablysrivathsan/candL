@echo off

start cmd /k "uvicorn api.main_parallel:app --reload --host 127.0.0.1 --port 8000"

start cmd /k "cd frontend && npm run dev"