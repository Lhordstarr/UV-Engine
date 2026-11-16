"""FastAPI application."""
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path
import os, shutil

from .hardware import detect_hardware, estimate_vram
from .models_registry import list_models, get_model
from .model_downloader import start_download, status as download_status, list_downloads, is_downloaded, MODELS_DIR
from .jobs import new_job, get_job, list_jobs, list_videos, VIDEOS_DIR, update_job
from .generator import submit
from .telemetry import record, stats
from .resources import resource_report
from .backends import backends_report
from .installer import start_install, status as install_status

app = FastAPI(title="AI Video Gen Studio", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateRequest(BaseModel):
    prompt: str
    model_id: str
    width: int | None = None
    height: int | None = None
    num_frames: int | None = None
    fps: int | None = None
    steps: int | None = None
    seed: int | None = None
    use_real: bool = False
    input_image: str | None = None

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "videogen"}

@app.post("/api/shutdown")
def shutdown():
    import threading, os, time
    def _exit():
        time.sleep(1.0)
        os._exit(0)
    threading.Thread(target=_exit, daemon=True).start()
    return {"status": "shutting_down"}

@app.get("/api/hardware")
def hardware():
    h = detect_hardware()
    return h

@app.get("/api/models")
def models(vram: float | None = None, type: str | None = None, q: str | None = None):
    avail = vram
    if avail is None:
        h = detect_hardware()
        avail = h["total_vram_gb"]
    ms = list_models(vram_available=avail, type_filter=type, query=q)
    for m in ms:
        m["downloaded"] = is_downloaded(m["id"])
        m["local_path"] = str(MODELS_DIR / m["id"]) if m["downloaded"] else None
    return {"models": ms, "vram_available": avail}

@app.get("/api/models/{mid}")
def model_detail(mid: str):
    m = get_model(mid)
    if not m:
        raise HTTPException(404, "model not found")
    # add estimates for a few presets
    presets = []
    for (w,h,f) in [(512,512,16),(720,480,24),(1024,576,25),(1280,720,49)]:
        presets.append({"width":w,"height":h,"frames":f,"vram_gb": estimate_vram(mid,w,h,f)})
    m["presets"] = presets
    return m

@app.post("/api/estimate")
def estimate(model_id: str, width: int = 512, height: int = 512, num_frames: int = 16, dtype: str = "fp16"):
    m = get_model(model_id)
    if not m:
        raise HTTPException(404, "model not found")
    return {"model_id": model_id, "vram_gb": estimate_vram(model_id, width, height, num_frames, dtype)}

@app.post("/api/models/{mid}/download")
def model_download(mid: str):
    m = get_model(mid)
    if not m:
        raise HTTPException(404, "model not found")
    started, msg = start_download(mid)
    return {"model_id": mid, "started": started, "message": msg, "status": download_status(mid)}

@app.get("/api/models/{mid}/download/status")
def model_download_status(mid: str):
    st = download_status(mid)
    if st is None:
        raise HTTPException(404, "model not found")
    return st

@app.get("/api/models/downloads")
def model_downloads():
    return {"downloads": list_downloads()}

@app.post("/api/generate")
def generate(req: GenerateRequest):
    m = get_model(req.model_id)
    if not m:
        raise HTTPException(400, "unknown model")
    params = req.model_dump()
    if not params.get("width"):
        params["width"] = m["default_resolution"][0]
    if not params.get("height"):
        params["height"] = m["default_resolution"][1]
    if not params.get("num_frames"):
        params["num_frames"] = m["default_frames"]
    if not params.get("fps"):
        params["fps"] = m["default_fps"]
    job = new_job(params)
    record("generate_submitted", {"job_id": job["id"], "model_id": req.model_id, "prompt_len": len(req.prompt or "")})
    submit(job["id"])
    return {"job_id": job["id"], "status": job["status"]}

@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    from .jobs import DATA_DIR as _DATA_DIR
    dest = None
    updir = _DATA_DIR / "uploads"
    updir.mkdir(parents=True, exist_ok=True)
    out = updir / file.filename
    with open(out, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"path": str(out), "filename": file.filename}

@app.get("/api/jobs")
def jobs(limit: int = 50):
    return {"jobs": list_jobs(limit)}

@app.get("/api/jobs/{jid}")
def job_detail(jid: str):
    j = get_job(jid)
    if not j:
        raise HTTPException(404, "job not found")
    return j

@app.post("/api/jobs/{jid}/cancel")
def cancel_job(jid: str):
    j = get_job(jid)
    if not j:
        raise HTTPException(404, "job not found")
    update_job(jid, status="cancelled", stage="Cancelled")
    return {"ok": True}

@app.get("/api/videos")
def videos():
    return {"videos": list_videos()}

@app.get("/api/videos/{filename}")
def video_file(filename: str):
    p = VIDEOS_DIR / filename
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="video/mp4", filename=filename)

class TelemetryRequest(BaseModel):
    event: str
    meta: dict | None = None

@app.post("/api/telemetry")
def post_telemetry(req: TelemetryRequest):
    record(req.event, req.meta)
    return {"ok": True}

@app.get("/api/telemetry/stats")
def telemetry_stats():
    return stats()

@app.get("/api/resources")
def resources():
    return {"resources": resource_report()}

@app.get("/api/backends")
def backends():
    return backends_report()

@app.post("/api/backends/install-ml")
def install_ml(backend: str = "ml"):
    started, msg = start_install(backend)
    return {"started": started, "message": msg, "status": install_status()["status"]}

@app.get("/api/backends/install-ml/status")
def install_ml_status():
    return install_status()

# Serve frontend build if present
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIST = _PROJECT_ROOT / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
