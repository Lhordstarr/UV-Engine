"""Download model weights from HuggingFace into local data/models/."""
import json
import os
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path

from .jobs import DATA_DIR
from .models_registry import get_model

MODELS_DIR = DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

_state = {}  # model_id -> dict
_lock = threading.Lock()


def _append(mid, msg):
    with _lock:
        st = _state.get(mid)
        if st is not None:
            st["log"].append({"t": time.time(), "msg": msg})
            if len(st["log"]) > 300:
                st["log"] = st["log"][-300:]


def _set(mid, **kwargs):
    with _lock:
        st = _state.get(mid)
        if st is not None:
            st.update(kwargs)
            st["updated_at"] = time.time()


def _list_remote_files(repo):
    """Return list of (path, size) for all files in the HF repo (recursive)."""
    url = f"https://huggingface.co/api/models/{repo}/tree/main?recursive=true"
    req = urllib.request.Request(url, headers={"User-Agent": "UV-Engine/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    files = []
    for entry in data:
        if entry.get("type") == "file":
            files.append((entry["path"], int(entry.get("size", 0) or 0)))
    return files


def _is_downloaded(mid, files):
    dest = MODELS_DIR / mid
    if not dest.exists():
        return False
    for path, size in files:
        p = dest / path
        if not p.exists() or (size > 0 and p.stat().st_size != size):
            return False
    return len(files) > 0


def start_download(model_id):
    model = get_model(model_id)
    if not model:
        return False, "unknown model"
    with _lock:
        st = _state.get(model_id)
        if st is not None and st.get("status") == "running":
            return False, "already running"
        _state[model_id] = {
            "model_id": model_id,
            "status": "queued",
            "progress": 0,
            "stage": "Queued",
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "current_file": None,
            "log": [],
            "started_at": time.time(),
            "finished_at": None,
            "path": str(MODELS_DIR / model_id),
            "error": None,
            "updated_at": time.time(),
        }
    t = threading.Thread(target=_run, args=(model_id,), daemon=True)
    t.start()
    return True, "started"


def _run(model_id):
    model = get_model(model_id)
    repo = model["source"]
    dest = MODELS_DIR / model_id
    dest.mkdir(parents=True, exist_ok=True)
    _set(model_id, status="running", stage="Listing files", progress=1)
    _append(model_id, f"Fetching file list for {repo}...")
    try:
        files = _list_remote_files(repo)
    except Exception as e:
        _append(model_id, f"Failed to list files: {e}")
        _set(model_id, status="error", stage="Error", error=str(e))
        return
    total = sum(s for _, s in files)
    _set(model_id, total_bytes=total, stage="Downloading", progress=2)
    _append(model_id, f"Found {len(files)} files ({_human(total)}).")

    downloaded = 0
    try:
        for path, size in files:
            _set(model_id, current_file=path)
            target = dest / path
            target.parent.mkdir(parents=True, exist_ok=True)
            # skip if already complete
            if target.exists() and size > 0 and target.stat().st_size == size:
                downloaded += size
                _set(model_id, downloaded_bytes=downloaded,
                     progress=_pct(downloaded, total))
                continue
            url = f"https://huggingface.co/{repo}/resolve/main/{path}"
            _append(model_id, f"Downloading {path}...")
            req = urllib.request.Request(url, headers={"User-Agent": "UV-Engine/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(target, "wb") as f:
                    chunk = resp.read(1024 * 1024)
                    while chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        _set(model_id, downloaded_bytes=downloaded,
                             progress=_pct(downloaded, total))
                        chunk = resp.read(1024 * 1024)
        # verify
        if _is_downloaded(model_id, files):
            _set(model_id, status="done", stage="Done", progress=100,
                 downloaded_bytes=total, finished_at=time.time())
            _append(model_id, f"Download complete: {dest}")
            try:
                from .telemetry import record
                record("model_downloaded", {"model_id": model_id, "path": str(dest)})
            except Exception:
                pass
        else:
            raise RuntimeError("Verification failed after download")
    except Exception as e:
        _append(model_id, f"ERROR: {e}")
        _set(model_id, status="error", stage="Error", error=str(e)[:300],
             finished_at=time.time())


def _pct(downloaded, total):
    if total <= 0:
        return 50
    return min(99, int(downloaded / total * 100))


def _human(n):
    if n >= 1024 ** 3:
        return f"{n / 1024 ** 3:.2f} GB"
    if n >= 1024 ** 2:
        return f"{n / 1024 ** 2:.1f} MB"
    return f"{n} B"


def status(model_id):
    with _lock:
        st = _state.get(model_id)
        if st is None:
            # check disk
            model = get_model(model_id)
            if not model:
                return None
            dest = MODELS_DIR / model_id
            if dest.exists() and any(dest.iterdir()):
                return {
                    "model_id": model_id,
                    "status": "done",
                    "progress": 100,
                    "stage": "Downloaded",
                    "downloaded_bytes": None,
                    "total_bytes": None,
                    "current_file": None,
                    "log": [],
                    "path": str(dest),
                    "error": None,
                }
            return {
                "model_id": model_id,
                "status": "idle",
                "progress": 0,
                "stage": "Not downloaded",
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "current_file": None,
                "log": [],
                "path": str(dest),
                "error": None,
            }
        return dict(st)


def list_downloads():
    from .models_registry import MODELS
    return [status(m["id"]) for m in MODELS]


def is_downloaded(model_id):
    model = get_model(model_id)
    if not model:
        return False
    dest = MODELS_DIR / model_id
    if not dest.exists():
        return False
    # lightweight: directory non-empty
    try:
        return any(dest.iterdir())
    except Exception:
        return False
