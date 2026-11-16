# AI Video Generation Studio

A local-first web app for generating videos with open-source AI video models. Works on any machine: it detects your GPU/VRAM, lists models with VRAM estimates, and lets you choose models that fit your hardware (or any tier). Generates real videos and lets you download them.

## Features
- 🎬 Text-to-Video & Image-to-Video model catalog (Wan, CogVideoX, HunyuanVideo, Mochi, LTX, SVD, AnimateDiff, …)
- 🧠 VRAM usage estimation per model and per resolution/frames
- 💻 Hardware detection (NVIDIA/AMD/Apple/CPU) with "fits your hardware" badges
- 📥 Download generated videos anytime
- 🎨 Sleek dark glass UI
- 🔌 Pluggable real generation via diffusers (GPU) with demo mode fallback

## Run

### One-command start (recommended)
```bash
./start.sh
```
This bootstraps the Python environment (`uv sync`, installing `uv` if missing), optionally builds the frontend, and starts the backend on port 1473 serving the UI.

### Manual

#### Backend
```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 1473
```

#### Frontend (dev)
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 (proxies /api to backend).

Production build is served by backend from `frontend/dist`.

## Enable real AI generation
Install ML deps and a GPU:
```bash
cd backend
uv sync --extra ml
```
Then check "Attempt real model" in the Generate page. Without a GPU it falls back to demo mode (animated preview) so the pipeline still works.

## Data
- Videos: `data/videos/`
- Jobs: `data/jobs/`
- Uploads: `data/uploads/`
