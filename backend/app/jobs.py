"""Job management and persistence."""
import json
import uuid
import time
import os
from pathlib import Path
from threading import Lock

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.environ.get("VG_DATA_DIR", str(_PROJECT_ROOT / "data")))
JOBS_DIR = DATA_DIR / "jobs"
VIDEOS_DIR = DATA_DIR / "videos"
JOBS_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

_jobs = {}
_lock = Lock()

def new_job(params):
    jid = uuid.uuid4().hex[:12]
    job = {
        "id": jid,
        "status": "queued",  # queued, running, done, error, cancelled
        "progress": 0,
        "stage": "Queued",
        "params": params,
        "created_at": time.time(),
        "updated_at": time.time(),
        "video_path": None,
        "error": None,
        "logs": [],
    }
    with _lock:
        _jobs[jid] = job
    _persist(job)
    return job

def get_job(jid):
    with _lock:
        if jid in _jobs:
            return dict(_jobs[jid])
    # load from disk
    p = JOBS_DIR / f"{jid}.json"
    if p.exists():
        job = json.loads(p.read_text())
        with _lock:
            _jobs[jid] = job
        return dict(job)
    return None

def update_job(jid, **kwargs):
    with _lock:
        job = _jobs.get(jid)
        if job is None:
            job = get_job(jid)
            if job is None:
                return None
            _jobs[jid] = job
        job.update(kwargs)
        job["updated_at"] = time.time()
        _persist(job)
        return dict(job)

def append_log(jid, msg):
    with _lock:
        job = _jobs.get(jid)
        if job is None:
            job = get_job(jid)
            if job is None: return
            _jobs[jid] = job
        job["logs"].append({"t": time.time(), "msg": msg})
        if len(job["logs"]) > 200:
            job["logs"] = job["logs"][-200:]
        _persist(job)

def list_jobs(limit=50):
    # gather from disk + memory
    ids = set(_jobs.keys())
    for p in JOBS_DIR.glob("*.json"):
        ids.add(p.stem)
    out = []
    for jid in ids:
        j = get_job(jid)
        if j: out.append(j)
    out.sort(key=lambda x: x["created_at"], reverse=True)
    return out[:limit]

def list_videos():
    out = []
    for p in sorted(VIDEOS_DIR.glob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.is_file():
            job_id = p.stem.split("_")[0] if "_" in p.stem else None
            out.append({
                "filename": p.name,
                "path": str(p),
                "size_bytes": p.stat().st_size,
                "created_at": p.stat().st_mtime,
                "url": f"/api/videos/{p.name}",
            })
    return out

def delete_video(filename):
    p = VIDEOS_DIR / filename
    if not p.exists() or not p.is_file():
        return False
    try:
        p.unlink()
        return True
    except Exception:
        return False

def delete_job(jid):
    with _lock:
        _jobs.pop(jid, None)
    p = JOBS_DIR / f"{jid}.json"
    if p.exists():
        try:
            p.unlink()
            return True
        except Exception:
            return False
    return True

def _persist(job):
    try:
        (JOBS_DIR / f"{job['id']}.json").write_text(json.dumps(job, indent=2, default=str))
    except Exception:
        pass
