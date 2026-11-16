"""Backend installation helpers (hardware-aware auto-download)."""
import subprocess, threading, time, os, sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = _PROJECT_ROOT / "backend"
_state = {"status": "idle", "log": [], "started_at": None, "finished_at": None,
          "hardware": None, "variant": None}
_lock_state = threading.Lock()

def _append(line):
    with _lock_state:
        _state["log"].append(line)
        if len(_state["log"]) > 800:
            _state["log"] = _state["log"][-800:]

def _detect_gpu():
    try:
        from .hardware import detect_hardware
        h = detect_hardware()
        gpus = h.get("gpus", [])
        # discrete gpu with vram
        for g in gpus:
            if g.get("vram_gb", 0) and g["vram_gb"] > 0:
                b = g.get("backend", "")
                if b in ("cuda", "nvidia", "amdgpu", "rocm"):
                    return b, g
        # apple
        if h.get("mps_available"):
            return "mps", None
        return "cpu", None
    except Exception:
        return "cpu", None

def start_install(backend="ml"):
    with _lock_state:
        if _state["status"] == "running":
            return False, "already running"
        _state["status"] = "running"
        _state["log"] = []
        _state["started_at"] = time.time()
        _state["finished_at"] = None
    vendor, gpu = _detect_gpu()
    with _lock_state:
        _state["hardware"] = vendor
    t = threading.Thread(target=_run, args=(backend, vendor), daemon=True)
    t.start()
    return True, "started"

def _run(backend, vendor):
    try:
        _append(f"Detected compute backend: {vendor}")
        _append("Step 1/2: uv sync --extra ml (base deps)")
        proc = subprocess.Popen(
            ["uv", "sync", "--extra", "ml"],
            cwd=str(BACKEND_DIR),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            _append(line.rstrip())
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"uv sync failed (exit {proc.returncode})")

        # Hardware-aware torch upgrade
        variant = "cpu"
        if vendor in ("cuda", "nvidia"):
            variant = "cuda"
            _append("Step 2/2: upgrading torch to CUDA build")
            idx = "https://download.pytorch.org/whl/cu124"
            cmd = ["uv", "pip", "install", "--upgrade", "torch", "torchvision", "torchaudio", "--index-url", idx]
        elif vendor in ("amdgpu", "rocm"):
            variant = "rocm"
            _append("Step 2/2: upgrading torch to ROCm build")
            idx = "https://download.pytorch.org/whl/rocm6.2"
            cmd = ["uv", "pip", "install", "--upgrade", "torch", "torchvision", "torchaudio", "--index-url", idx]
        elif vendor == "mps":
            variant = "mps"
            _append("Step 2/2: torch (MPS support is in the default wheel)")
            cmd = None
        else:
            variant = "cpu"
            _append("Step 2/2: keeping CPU torch (no supported GPU detected)")
            cmd = None

        with _lock_state:
            _state["variant"] = variant

        if cmd:
            proc2 = subprocess.Popen(cmd, cwd=str(BACKEND_DIR),
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in proc2.stdout:
                _append(line.rstrip())
            proc2.wait()
            if proc2.returncode != 0:
                _append(f"WARNING: torch upgrade failed (exit {proc2.returncode}); CPU build remains")

        with _lock_state:
            _state["status"] = "done"
            _state["finished_at"] = time.time()
        _append(f"Done. Installed variant: {variant}")
    except Exception as e:
        with _lock_state:
            _state["status"] = "error"
            _state["finished_at"] = time.time()
        _append(f"ERROR: {e}")

def status():
    with _lock_state:
        return {
            "status": _state["status"],
            "started_at": _state["started_at"],
            "finished_at": _state["finished_at"],
            "hardware": _state["hardware"],
            "variant": _state["variant"],
            "log_tail": _state["log"][-50:],
        }
