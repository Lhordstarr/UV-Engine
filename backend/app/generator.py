"""Video generation worker."""
import os
import time
import threading
import subprocess
import shutil
from pathlib import Path
from .jobs import update_job, append_log, VIDEOS_DIR
from .models_registry import get_model
from .hardware import detect_hardware

_hw = None
def hw():
    global _hw
    if _hw is None:
        _hw = detect_hardware()
    return _hw

def _try_real_generation(job):
    """Attempt real diffusers generation. Returns path or raises."""
    import torch
    h = hw()
    # Allow CPU (slow) as a fallback for real generation when no GPU is present
    # Lazy imports
    from diffusers import DiffusionPipeline
    params = job["params"]
    mid = params["model_id"]
    model = get_model(mid)
    prompt = params["prompt"]
    width = params.get("width", model["default_resolution"][0])
    height = params.get("height", model["default_resolution"][1])
    num_frames = params.get("num_frames", model["default_frames"])
    steps = params.get("steps", 25)
    seed = params.get("seed")
    # Map model id to diffusers pipeline class / model name - best effort
    repo = model["source"]
    device = "cuda" if h["cuda_available"] else ("mps" if h["mps_available"] else "cpu")
    dtype = torch.float16 if device != "cpu" else torch.float32
    append_log(job["id"], f"Loading {repo} on {device}...")
    update_job(job["id"], stage="Loading model", progress=5)
    pipe = DiffusionPipeline.from_pretrained(repo, torch_dtype=dtype)
    pipe.to(device)
    update_job(job["id"], stage="Generating", progress=15)
    g = torch.Generator(device=device)
    if seed is not None:
        g.manual_seed(seed)
    # Generic call - may not work for all; wrap
    result = pipe(prompt, num_frames=num_frames, width=width, height=height, num_inference_steps=steps, generator=g)
    frames = result.frames[0] if hasattr(result, "frames") else result.images
    # Save frames -> video via imageio? Use ffmpeg
    tmpdir = VIDEOS_DIR / f"tmp_{job['id']}"
    tmpdir.mkdir(exist_ok=True)
    for i, f in enumerate(frames):
        f.save(tmpdir / f"frame_{i:04d}.png")
    out = VIDEOS_DIR / f"{job['id']}_{_slug(prompt)}.mp4"
    _frames_to_video(tmpdir, out, params.get("fps", model["default_fps"]))
    shutil.rmtree(tmpdir, ignore_errors=True)
    return out

def _slug(s):
    import re
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return (s[:40] or "video")

def _frames_to_video(tmpdir, out, fps):
    cmd = [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(tmpdir / "frame_%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def run_job(job_id):
    job = None
    from .jobs import get_job
    job = get_job(job_id)
    if not job:
        return
    update_job(job_id, status="running", stage="Starting", progress=2)
    append_log(job_id, f"Job started: {job['params'].get('prompt','')[:60]}")
    try:
        # Respect backend toggle
        try:
            from .settings import is_backend_enabled
            if not is_backend_enabled("diffusers"):
                raise RuntimeError("diffusers backend disabled by user")
        except RuntimeError:
            raise
        except Exception:
            pass
        out = _try_real_generation(job)
        update_job(job_id, status="done", stage="Done", progress=100, video_path=str(out))
        append_log(job_id, f"Finished: {out.name}")
        try:
            from .telemetry import record
            job = get_job(job_id)
            record("generation_completed", {"job_id": job_id, "model_id": job["params"].get("model_id"), "video": str(out.name)})
        except Exception:
            pass
    except Exception as e:
        update_job(job_id, status="error", stage="Error", error=str(e), real_generation_error=str(e)[:300])
        append_log(job_id, f"ERROR: {e}")
        try:
            from .telemetry import record
            record("generation_failed", {"job_id": job_id, "error": str(e)[:200]})
        except Exception:
            pass

def submit(job_id):
    t = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    t.start()
    return t
