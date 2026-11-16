"""Simple persistent settings store (backend toggles, etc.)."""
import json
import os
from pathlib import Path
from .jobs import DATA_DIR

SETTINGS_FILE = DATA_DIR / "settings.json"
_lock = None
import threading
_lock = threading.Lock()

_DEFAULTS = {
    "backends_enabled": {
        "python": True,
        "diffusers": True,
        "ffmpeg": True,
        "onnxruntime": True,
        "sdcpp": True,
    }
}


def _load():
    if SETTINGS_FILE.exists():
        try:
            d = json.loads(SETTINGS_FILE.read_text())
            # merge defaults
            be = _DEFAULTS["backends_enabled"].copy()
            be.update(d.get("backends_enabled", {}))
            d["backends_enabled"] = be
            return d
        except Exception:
            pass
    return json.loads(json.dumps(_DEFAULTS))


def _save(d):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(d, indent=2))


def get_settings():
    with _lock:
        return _load()


def is_backend_enabled(bid):
    d = get_settings()
    return bool(d.get("backends_enabled", {}).get(bid, True))


def set_backend_enabled(bid, enabled):
    with _lock:
        d = _load()
        d.setdefault("backends_enabled", {})
        d["backends_enabled"][bid] = bool(enabled)
        _save(d)
        return d["backends_enabled"][bid]