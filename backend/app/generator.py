"""Video generation: real diffusers (GPU/CPU) with no demo fallback."""
import inspect
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .jobs import get_job, update_job, append_log, VIDEOS_DIR
from .models_registry import get_model
from .hardware import detect_hardware


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


def hw():
    from .hardware import detect_hardware
    global _hw
    try:
        _hw
    except NameError:
        _hw = None
    if _hw is None:
        _hw = detect_hardware()
    return _hw


_hw = None


def _try_real_generation(job):
    """Attempt real diffusers generation. Returns path or raises."""
    import torch

    h = hw()
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
    fps = params.get("fps", model["default_fps"])
    repo = model["source"]
    device = "cuda" if h["cuda_available"] else ("mps" if h["mps_available"] else "cpu")
    dtype = torch.float16 if device != "cpu" else torch.float32
    append_log(job["id"], f"Loading {repo} on {device}...")
    update_job(job["id"], stage="Loading model", progress=5)
    try:
        pipe = DiffusionPipeline.from_pretrained(repo, torch_dtype=dtype, trust_remote_code=True)
    except TypeError:
        pipe = DiffusionPipeline.from_pretrained(repo, torch_dtype=dtype)
    pipe.to(device)
    update_job(job["id"], stage="Generating", progress=15)
    g = torch.Generator(device=device)
    if seed is not None:
        g.manual_seed(seed)

    # Build call kwargs adapted to the pipeline's actual signature
    try:
        sig = inspect.signature(pipe.__call__)
        accepted = set(sig.parameters.keys())
    except Exception:
        accepted = None

    kwargs = {}
    if accepted is None or "prompt" in accepted:
        kwargs["prompt"] = prompt
    if accepted is None or "num_inference_steps" in accepted:
        kwargs["num_inference_steps"] = steps
    if accepted is None or "generator" in accepted:
        kwargs["generator"] = g
    if accepted is None or "width" in accepted:
        kwargs["width"] = width
    if accepted is None or "height" in accepted:
        kwargs["height"] = height
    if accepted is None or "num_frames" in accepted:
        kwargs["num_frames"] = num_frames
    if accepted is None or "fps" in accepted:
        kwargs["fps"] = fps

    # Image-to-video: load input image if provided
    input_image_path = params.get("input_image") or params.get("input_image_path")
    if input_image_path:
        try:
            from PIL import Image
            img = Image.open(input_image_path).convert("RGB")
            if accepted is None or "image" in accepted:
                kwargs["image"] = img
            elif accepted is None or "video" in accepted:
                kwargs["video"] = img
        except Exception as e:
            append_log(job["id"], f"Could not load input image: {e}")

    try:
        result = pipe(**kwargs)
    except TypeError as e:
        append_log(job["id"], f"Retrying call with reduced args: {e}")
        minimal = {}
        if accepted is None or "num_inference_steps" in accepted:
            minimal["num_inference_steps"] = steps
        if accepted is None or "generator" in accepted:
            minimal["generator"] = g
        result = pipe(prompt, **minimal)

    # Extract frames
    frames = None
    if hasattr(result, "frames") and result.frames is not None:
        frames = result.frames[0] if isinstance(result.frames, (list, tuple)) else result.frames
    elif hasattr(result, "videos") and result.videos is not None:
        frames = result.videos[0] if isinstance(result.videos, (list, tuple)) else result.videos
    elif hasattr(result, "images") and result.images is not None:
        frames = result.images
    else:
        if isinstance(result, (list, tuple)):
            frames = result
        else:
            raise RuntimeError("Could not extract frames from pipeline result")

    if not frames:
        raise RuntimeError("Pipeline returned no frames")

    # Save frames -> video via ffmpeg
    tmpdir = VIDEOS_DIR / f"tmp_{job['id']}"
    tmpdir.mkdir(exist_ok=True)
    for i, f in enumerate(frames):
        if hasattr(f, "save"):
            f.save(tmpdir / f"frame_{i:04d}.png")
        else:
            raise RuntimeError("Frame is not a PIL image; unsupported pipeline output")
    out = VIDEOS_DIR / f"{job['id']}_{_slug(prompt)}.mp4"
    _frames_to_video(tmpdir, out, fps)
    shutil.rmtree(tmpdir, ignore_errors=True)
    return out


def run_job(job_id):
    job = None
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
        update_job(job_id, status="done", stage="Done", progress=100, video_path=str(out), real_generation_error=None)
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