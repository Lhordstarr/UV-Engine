"""Telemetry storage and stats."""
import json, time, os
from pathlib import Path
from collections import Counter, defaultdict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.environ.get("VG_DATA_DIR", str(_PROJECT_ROOT / "data")))
TELEMETRY_FILE = DATA_DIR / "telemetry.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

def _load():
    if TELEMETRY_FILE.exists():
        try:
            return json.loads(TELEMETRY_FILE.read_text())
        except Exception:
            pass
    return {"events": []}

def _save(d):
    TELEMETRY_FILE.write_text(json.dumps(d, indent=2))

def record(event, meta=None):
    d = _load()
    d["events"].append({"event": event, "meta": meta or {}, "ts": time.time()})
    if len(d["events"]) > 5000:
        d["events"] = d["events"][-5000:]
    _save(d)
    return True

def stats():
    d = _load()
    events = d["events"]
    counts = Counter(e["event"] for e in events)
    model_usage = Counter(e["meta"].get("model_id") for e in events if e["meta"].get("model_id"))
    recent = events[-20:][::-1]
    # generations over time (by day)
    by_day = defaultdict(int)
    for e in events:
        if e["event"] in ("generate_submitted", "generation_completed"):
            by_day[time.strftime("%Y-%m-%d", time.localtime(e["ts"]))] += 1
    return {
        "total_events": len(events),
        "counts": dict(counts),
        "model_usage": dict(model_usage),
        "recent": recent,
        "by_day": dict(by_day),
    }
