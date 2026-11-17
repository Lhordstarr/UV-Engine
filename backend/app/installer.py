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

_OPTIONAL_PACKAGES = {
    "onnxruntime": "onnxruntime",
}


def start_install(backend="ml"):
    with _lock_state:
        if _state["status"] == "running":
            return False, "already running"
        _state["status"] = "running"
        _state["log"] = []
        _state["started_at"] = time.time()
        _state["finished_at"] = None
    if backend == "ml":
        vendor, gpu = _detect_gpu()
        with _lock_state:
            _state["hardware"] = vendor
        t = threading.Thread(target=_run, args=(backend, vendor), daemon=True)
        t.start()
        return True, "started"
    # optional backend install
    pkg = _OPTIONAL_PACKAGES.get(backend)
    if not pkg:
        with _lock_state:
            _state["status"] = "idle"
        return False, f"no installer for {backend}"
    t = threading.Thread(target=_run_optional, args=(backend, pkg), daemon=True)
    t.start()
    return True, "started"


def _run_optional(backend, pkg):
    try:
        _append(f"Installing optional backend: {backend} ({pkg})")
        from pathlib import Path as _Path
        _PROJECT_ROOT = _Path(__file__).resolve().parent.parent.parent
        BACKEND_DIR = _PROJECT_ROOT / "backend"
        cmd = ["uv", "pip", "install", "--python", str(BACKEND_DIR / ".venv" / "bin" / "python"), pkg]
        proc = subprocess.Popen(cmd, cwd=str(BACKEND_DIR),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            _append(line.rstrip())
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"install failed (exit {proc.returncode})")
        with _lock_state:
            _state["status"] = "done"
            _state["finished_at"] = time.time()
        _append(f"Done. Installed: {backend}")
    except Exception as e:
        with _lock_state:
            _state["status"] = "error"
            _state["finished_at"] = time.time()
        _append(f"ERROR: {e}")

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

        # Step 2: keep the torch already installed by `uv sync --extra ml`.
        # PyPI torch (>=2.6) ships CUDA wheels on Linux, which are compatible
        # with the pinned diffusers. Upgrading to a separate index (cu124/rocm)
        # previously installed an incompatible torch and broke real generation.
        variant = "cuda" if vendor in ("cuda", "nvidia") else ("rocm" if vendor in ("amdgpu", "rocm") else ("mps" if vendor == "mps" else "cpu"))
        _append(f"Step 2/2: keeping torch from uv sync (variant: {variant})")
        cmd = None

        with _lock_state:
            _state["variant"] = variant

        if cmd:
            # Target the project venv explicitly so torch lands where the backend runs
            cmd = ["uv", "pip", "install", "--python", str(BACKEND_DIR / ".venv" / "bin" / "python")] + cmd[3:]
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
