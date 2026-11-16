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
# Install ML deps (torch/diffusers) automatically when a GPU is present,
# so real video generation works out of the box. CPU-only machines stay light.
if command -v nvidia-smi >/dev/null 2>&1; then
  HAS_GPU=1
elif [ -d /sys/class/drm ] && grep -q "0x1002\|0x10de" /sys/class/drm/card*/device/vendor 2>/dev/null; then
  HAS_GPU=1
else
  HAS_GPU=0
fi

if [ "$HAS_GPU" = "1" ]; then
  echo "GPU detected; syncing Python environment with ML deps (uv sync --extra ml)..."
  uv sync --extra ml
else
  echo "No GPU detected; syncing base Python environment (uv sync)..."
  uv sync
fi

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

# --- Free the port if a previous instance is still running ---
PORT=1473
free_port() {
  local pids=""
  if command -v ss >/dev/null 2>&1; then
    pids=$(ss -ltnp 2>/dev/null | grep ":$PORT " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
  elif command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti tcp:$PORT 2>/dev/null)
  elif command -v fuser >/dev/null 2>&1; then
    pids=$(fuser "$PORT/tcp" 2>/dev/null)
  fi
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping previous instance on port $PORT (pid $pid)..."
      kill "$pid" 2>/dev/null || true
    fi
  done
  # wait for port to be released
  for _ in 1 2 3 4 5; do
    if ! (ss -ltn 2>/dev/null | grep -q ":$PORT ") && ! (lsof -i :$PORT >/dev/null 2>&1); then
      break
    fi
    sleep 0.5
  done
}
free_port

# --- Start backend (serves built frontend) ---
exec uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT