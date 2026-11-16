#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
# Start backend (serves built frontend)
cd backend
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000