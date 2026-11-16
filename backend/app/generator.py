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
    # Only attempt if GPU present
    h = hw()
    if not h["gpus"] or h["gpus"][0]["backend"] == "cpu":
        raise RuntimeError("No GPU available for real generation")
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

def _demo_generation(job):
    """Generate a demo video with ffmpeg (no GPU needed)."""
    params = job["params"]
    model = get_model(params["model_id"])
    prompt = params["prompt"]
    width = params.get("width", model["default_resolution"][0])
    height = params.get("height", model["default_resolution"][1])
    # keep demo small
    width = min(width, 832)
    height = min(height, 480)
    num_frames = params.get("num_frames", min(model["default_frames"], 48))
    fps = params.get("fps", model["default_fps"])
    duration = max(2.0, num_frames / fps)
    out = VIDEOS_DIR / f"{job['id']}_{_slug(prompt)}.mp4"
    input_image = params.get("input_image_path")

    append_log(job["id"], "Demo mode: generating animated preview video (no GPU model available).")
    update_job(job["id"], stage="Preparing", progress=10)

    if input_image and Path(input_image).exists():
        # Ken-burns from image + prompt overlay
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
            f"zoompan=z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={int(duration*fps)}:s={width}x{height},"
            f"drawtext=text='{_escape(prompt)}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=h-60"
        )
        cmd = [
            "ffmpeg", "-y", "-loop", "1", "-i", input_image,
            "-vf", vf, "-t", str(duration), "-r", str(fps),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
        ]
    else:
        # Animated gradient + prompt + model badge
        # Use color source with shifting hue
        vf = (
            f"color=c=0x1a1a2e:s={width}x{height}:r={fps},"
            f"geq=r='128+127*sin(2*PI*(X+T*40)/{width})':g='128+127*sin(2*PI*(Y+T*30)/{height})':b='180+75*cos(2*PI*T/4)',"
            f"drawtext=text='AI Video Gen - DEMO':fontcolor=white@0.9:fontsize=28:box=1:boxcolor=black@0.4:boxborderw=10:x=(w-text_w)/2:y=40,"
            f"drawtext=text='{_escape(prompt)}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=h-80,"
            f"drawtext=text='{_escape(model['name'])}  |  {width}x{height}  |  {num_frames}f':fontcolor=#a0a0ff:fontsize=16:x=20:y=h-30"
        )
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", vf,
            "-t", str(duration),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
        ]

    update_job(job["id"], stage="Rendering", progress=30)
    append_log(job["id"], "Running ffmpeg...")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        append_log(job["id"], "ffmpeg stderr: " + proc.stderr[-500:])
        raise RuntimeError("ffmpeg failed: " + proc.stderr[-300:])
    # progress to 100
    for p in range(40, 101, 10):
        update_job(job["id"], progress=p)
        time.sleep(0.1)
    return out

def _escape(s):
    # escape for ffmpeg drawtext
    s = s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")
    # truncate
    if len(s) > 80:
        s = s[:77] + "..."
    return s

def run_job(job_id):
    job = None
    from .jobs import get_job
    job = get_job(job_id)
    if not job:
        return
    update_job(job_id, status="running", stage="Starting", progress=2)
    append_log(job_id, f"Job started: {job['params'].get('prompt','')[:60]}")
    try:
        # Decide mode
        use_real = job["params"].get("use_real", False)
        real_ok = False
        if use_real:
            try:
                out = _try_real_generation(job)
                real_ok = True
            except Exception as e:
                append_log(job_id, f"Real generation unavailable: {e}")
                update_job(job_id, real_generation_error=str(e)[:300])
                real_ok = False
        if not real_ok:
            out = _demo_generation(job)
        update_job(job_id, status="done", stage="Done", progress=100, video_path=str(out))
        append_log(job_id, f"Finished: {out.name}")
        try:
            from .telemetry import record
            job = get_job(job_id)
            record("generation_completed", {"job_id": job_id, "model_id": job["params"].get("model_id"), "video": str(out.name)})
        except Exception:
            pass
    except Exception as e:
        update_job(job_id, status="error", stage="Error", error=str(e))
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
