"""Execution backends for video generation: what is actually running and on what."""
import shutil, subprocess, sys

def _torch_info():
    try:
        import torch
        cuda = bool(torch.cuda.is_available())
        mps = False
        try:
            mps = bool(hasattr(torch, "mps") and torch.backends.mps.is_available())
        except Exception:
            mps = False
        rocm = False
        try:
            rocm = bool(getattr(torch.version, "hip", None))
        except Exception:
            rocm = False
        if cuda:
            try:
                name = torch.cuda.get_device_name(0)
            except Exception:
                name = "CUDA GPU"
            device = "gpu"
            backend = "rocm" if rocm else "cuda"
        elif mps:
            name = "Apple MPS"
            device = "gpu"
            backend = "mps"
        else:
            name = None
            device = "cpu"
            backend = "cpu"
        return {
            "installed": True,
            "version": torch.__version__,
            "cuda": cuda,
            "mps": mps,
            "rocm": rocm,
            "backend": backend,
            "device": device,
            "deviceName": name,
        }
    except Exception as e:
        return {"installed": False, "error": str(e)[:200], "cuda": False, "mps": False, "rocm": False,
                "backend": "none", "device": "none", "deviceName": None, "version": None}

def _diffusers_info():
    try:
        import diffusers
        return {"installed": True, "version": diffusers.__version__}
    except Exception as e:
        return {"installed": False, "error": str(e)[:120]}

def _onnx_info():
    try:
        import onnxruntime as ort
        return {"installed": True, "version": ort.__version__, "providers": ort.get_available_providers()}
    except Exception as e:
        return {"installed": False, "error": str(e)[:120], "providers": []}

def _ffmpeg_info():
    if not shutil.which("ffmpeg"):
        return {"installed": False}
    try:
        out = subprocess.check_output(["ffmpeg", "-version"], text=True, timeout=5).splitlines()[0]
        return {"installed": True, "version": out.strip(), "path": shutil.which("ffmpeg")}
    except Exception as e:
        return {"installed": True, "error": str(e)[:120], "path": shutil.which("ffmpeg")}

def _sdcpp_info():
    # stable-diffusion.cpp binary (optional)
    for name in ("sd", "stable-diffusion-cli", "sdcpp"):
        p = shutil.which(name)
        if p:
            return {"installed": True, "path": p, "binary": name}
    return {"installed": False}

def backends_report():
    torch = _torch_info()
    diffusers = _diffusers_info()
    onnx = _onnx_info()
    ffmpeg = _ffmpeg_info()
    sdcpp = _sdcpp_info()

    # Python backend device
    if not torch["installed"]:
        python_device = "none"
        python_detail = "PyTorch not installed — needed for real diffusion generation"
    elif torch["device"] == "gpu":
        python_detail = f"On the GPU via {torch['deviceName'] or torch['backend'].upper()}"
        python_device = "gpu"
    else:
        python_detail = "On the CPU (CPU-only torch build)"
        python_device = "cpu"

    reports = []
    reports.append({
        "id": "python",
        "label": "Python runtime (torch)",
        "device": python_device,
        "detail": python_detail,
        "controllable": True,
        "readonlyReason": None,
        "evidence": (f"torch {torch['version']} — is_available()={torch['cuda'] or torch['mps']}" if torch["installed"] else "torch not importable"),
        "meta": torch,
    })
    reports.append({
        "id": "diffusers",
        "label": "diffusers (video pipelines)",
        "device": ("gpu" if (torch["installed"] and torch["device"] == "gpu" and diffusers["installed"]) else
                   ("cpu" if (diffusers["installed"]) else "none")),
        "detail": (f"Installed {diffusers['version']}" if diffusers["installed"] else "Not installed — real generation disabled"),
        "controllable": False,
        "readonlyReason": "Install with: uv sync --extra ml",
        "evidence": ("diffusers importable" if diffusers["installed"] else diffusers.get("error", "not importable")),
        "meta": diffusers,
    })
    reports.append({
        "id": "ffmpeg",
        "label": "ffmpeg (render / encode)",
        "device": "cpu",
        "detail": (f"Installed: {ffmpeg.get('version','')[:60]}" if ffmpeg["installed"] else "NOT FOUND — generation will fail"),
        "controllable": False,
        "readonlyReason": "System binary; install via package manager.",
        "evidence": ffmpeg.get("path") or "not found on PATH",
        "meta": ffmpeg,
    })
    providers = onnx.get("providers", [])
    onnx_device = "gpu" if any("CUDA" in p or "ROCM" in p or "TensorRT" in p for p in providers) else ("cpu" if providers else "none")
    reports.append({
        "id": "onnxruntime",
        "label": "ONNX Runtime",
        "device": onnx_device,
        "detail": (f"{', '.join(providers)}" if providers else ("Installed but no providers" if onnx["installed"] else "Not installed")),
        "controllable": False,
        "readonlyReason": "Wheel choice fixes providers.",
        "evidence": (f"get_available_providers() = {providers}" if onnx["installed"] else onnx.get("error", "not importable")),
        "meta": onnx,
    })
    reports.append({
        "id": "sdcpp",
        "label": "stable-diffusion.cpp",
        "device": ("gpu" if sdcpp["installed"] else "none"),
        "detail": (f"Found at {sdcpp['path']}" if sdcpp["installed"] else "Not installed (optional)"),
        "controllable": False,
        "readonlyReason": "Optional native backend.",
        "evidence": sdcpp.get("path") or "not on PATH",
        "meta": sdcpp,
    })
    # Annotate optionality + hardware requirements (optional backends, install
    # only when hardware meets the requirement).
    try:
        from .hardware import detect_hardware
        hw = detect_hardware()
        gpu_present = any(g.get("vram_gb", 0) and g["vram_gb"] > 0 for g in hw.get("gpus", []))
    except Exception:
        gpu_present = False
        hw = {}
    req_map = {
        "python": (["CPU (always)"], True),
        "diffusers": (["CPU (always); GPU for acceleration"], True),
        "ffmpeg": (["system package manager"], True),
        "onnxruntime": (["CPU (always); GPU providers optional"], True),
        "sdcpp": (["GPU recommended"], gpu_present if False else True),
    }
    try:
        from .settings import is_backend_enabled
    except Exception:
        def is_backend_enabled(bid):
            return True
    for r in reports:
        r["optional"] = True
        r["controllable"] = True
        r["enabled"] = is_backend_enabled(r["id"])
        r["readonlyReason"] = None
        r["requirements"], r["meets_requirements"] = req_map.get(r["id"], (["none"], True))
    return {"backends": reports, "torch": torch, "hardware": {
        "gpu_present": gpu_present,
        "total_vram_gb": hw.get("total_vram_gb", 0),
    }}
