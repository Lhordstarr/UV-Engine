#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# --- Ensure uv (Python package manager) is available ---
if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found; installing uv..."
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | sh
  else
    echo "ERROR: need curl or wget to install uv" >&2
    exit 1
  fi
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
fi

cd backend

# --- Create/sync the Python environment ---
echo "Syncing Python environment (uv sync)..."
uv sync

# --- Optionally build the frontend if a build is missing ---
if [ ! -f "../frontend/dist/index.html" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Frontend build not found; building (npm run build)..."
    (cd ../frontend && npm install --silent && npm run build)
  else
    echo "WARNING: frontend/dist missing and npm not found; UI will not be served (API only)." >&2
  fi
fi

# --- Check ffmpeg (needed for demo generation) ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "WARNING: ffmpeg not found; video generation will fail. Install ffmpeg via your package manager." >&2
fi

# --- Start backend (serves built frontend) ---
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 1473