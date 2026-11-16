"""Hardware detection and VRAM estimation helpers."""
import os
import platform
import subprocess
import shutil

def detect_hardware():
    info = {
        "platform": platform.system(),
        "python": platform.python_version(),
        "cpu": platform.processor() or "Unknown",
        "ram_gb": _ram_gb(),
        "gpus": [],
        "torch_available": False,
        "cuda_available": False,
        "rocm_available": False,
        "mps_available": False,
        "total_vram_gb": 0.0,
    }
    # Try torch
    try:
        import torch
        info["torch_available"] = True
        info["torch_version"] = torch.__version__
        if torch.cuda.is_available():
            info["cuda_available"] = True
            for i in range(torch.cuda.device_count()):
                p = torch.cuda.get_device_properties(i)
                vram = p.total_memory / (1024**3)
                info["gpus"].append({
                    "index": i,
                    "name": p.name,
                    "vram_gb": round(vram, 2),
                    "backend": "cuda",
                })
                info["total_vram_gb"] += vram
        if hasattr(torch, "mps") and torch.backends.mps.is_available():
            info["mps_available"] = True
            info["gpus"].append({"index": 0, "name": "Apple Silicon (MPS)", "vram_gb": info["ram_gb"] * 0.75, "backend": "mps"})
            info["total_vram_gb"] = info["ram_gb"] * 0.75
        # ROCm shows up as cuda sometimes; also check
    except Exception as e:
        info["torch_error"] = str(e)

    # Fallback: nvidia-smi
    if not info["gpus"] and shutil.which("nvidia-smi"):
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"],
                text=True, timeout=10,
            )
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 3:
                    vram = float(parts[2]) / 1024.0
                    info["gpus"].append({"index": int(parts[0]), "name": parts[1], "vram_gb": round(vram, 2), "backend": "cuda"})
                    info["total_vram_gb"] += vram
            info["cuda_available"] = True
        except Exception as e:
            info["nvidia_smi_error"] = str(e)

    # AMD rocm-smi
    if not info["gpus"] and shutil.which("rocm-smi"):
        try:
            out = subprocess.check_output(["rocm-smi", "--showmeminfo", "vram", "--json"], text=True, timeout=10)
            import json
            data = json.loads(out)
            for k, v in data.items():
                if isinstance(v, dict):
                    vram = float(v.get("VRAM Total (B)", 0)) / (1024**3) if "VRAM Total (B)" in v else 0
                    if vram > 0:
                        info["gpus"].append({"index": int(k.split()[-1]) if k.split() else 0, "name": v.get("Card Series", "AMD GPU"), "vram_gb": round(vram, 2), "backend": "rocm"})
                        info["total_vram_gb"] += vram
            info["rocm_available"] = True
        except Exception as e:
            info["rocm_error"] = str(e)

    # Enumerate GPUs exposed by the kernel (AMD/Intel/NVIDIA) via sysfs DRM.
    if not info["gpus"]:
        try:
            from pathlib import Path as _P
            idx = 0
            for e in sorted(_P("/sys/class/drm").iterdir()):
                if not (e.name.startswith("card") and e.name[4:].isdigit()):
                    continue
                vendor_file = e / "device" / "vendor"
                if not vendor_file.exists():
                    continue
                vendor = vendor_file.read_text().strip()
                if vendor == "0x1002":
                    name = None
                    pn = e / "device" / "product_name"
                    if pn.exists():
                        name = pn.read_text().strip() or None
                    if not name:
                        try:
                            out = subprocess.check_output(["lspci"], text=True, timeout=4)
                            for line in out.splitlines():
                                if "AMD" in line and ("VGA" in line or "Display" in line or "3D" in line):
                                    nm = line.split(":", 2)[-1].strip() if ":" in line else line.strip()
                                    if "[" in nm and "]" in nm:
                                        nm = nm[nm.rfind("[")+1:nm.rfind("]")]
                                    name = nm or "AMD GPU"
                                    break
                        except Exception:
                            name = "AMD GPU"
                    if not name:
                        name = "AMD GPU"
                    vram_bytes = None
                    vt = e / "device" / "mem_info_vram_total"
                    if vt.exists():
                        try:
                            vram_bytes = int(vt.read_text().strip())
                        except Exception:
                            vram_bytes = None
                    if vram_bytes and vram_bytes > 0:
                        vram = vram_bytes / (1024**3)
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": round(vram, 2), "backend": "amdgpu"})
                        info["total_vram_gb"] += vram
                        info["rocm_available"] = True
                        idx += 1
                    else:
                        # AMD without readable VRAM (older radeon) -> shared estimate
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": 0.0, "backend": "amdgpu"})
                        idx += 1
                elif vendor == "0x8086":
                    name = "Intel Integrated Graphics"
                    vt = e / "device" / "mem_info_vram_total"
                    vram_bytes = None
                    if vt.exists():
                        try:
                            vram_bytes = int(vt.read_text().strip())
                        except Exception:
                            vram_bytes = None
                    if vram_bytes and vram_bytes > 0:
                        vram = vram_bytes / (1024**3)
                        name = "Intel Arc GPU"
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": round(vram, 2), "backend": "intel"})
                        info["total_vram_gb"] += vram
                    else:
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": 0.0, "backend": "intel"})
                    idx += 1
                elif vendor == "0x10de":
                    # NVIDIA not caught by nvidia-smi? try sysfs name + vram
                    name = "NVIDIA GPU"
                    pn = e / "device" / "product_name"
                    # product_name rarely present; use lspci
                    try:
                        out = subprocess.check_output(["lspci"], text=True, timeout=4)
                        for line in out.splitlines():
                            if "NVIDIA" in line and ("VGA" in line or "Display" in line or "3D" in line):
                                nm = line.split(":", 2)[-1].strip() if ":" in line else line.strip()
                                if "[" in nm and "]" in nm:
                                    nm = nm[nm.rfind("[")+1:nm.rfind("]")]
                                name = nm or name
                                break
                    except Exception:
                        pass
                    vt = e / "device" / "mem_info_vram_total"
                    vram_bytes = None
                    if vt.exists():
                        try:
                            vram_bytes = int(vt.read_text().strip())
                        except Exception:
                            vram_bytes = None
                    if vram_bytes and vram_bytes > 0:
                        vram = vram_bytes / (1024**3)
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": round(vram, 2), "backend": "nvidia"})
                        info["total_vram_gb"] += vram
                        info["cuda_available"] = True
                    else:
                        info["gpus"].append({"index": idx, "name": name, "vram_gb": 0.0, "backend": "nvidia"})
                    idx += 1
        except Exception as ex:
            info["sysfs_error"] = str(ex)

    # Shared-memory fallback for integrated-only setups
    discrete_vram = sum(g["vram_gb"] for g in info["gpus"] if g["vram_gb"] and g["vram_gb"] > 0)
    if not info["gpus"]:
        info["gpus"].append({"index": 0, "name": "CPU / Integrated (no discrete GPU detected)", "vram_gb": round(info["ram_gb"] * 0.5, 2), "backend": "cpu"})
        info["total_vram_gb"] = round(info["ram_gb"] * 0.5, 2)
    elif discrete_vram == 0:
        # only integrated GPUs found; use shared RAM estimate
        shared = round(info["ram_gb"] * 0.5, 2)
        info["total_vram_gb"] = shared
        for g in info["gpus"]:
            if g["vram_gb"] == 0:
                g["vram_gb"] = shared
    else:
        if info["total_vram_gb"] == 0:
            info["total_vram_gb"] = discrete_vram

    return info

def _ram_gb():
    try:
        import psutil
        return round(psutil.virtual_memory().total / (1024**3), 2)
    except Exception:
        # /proc/meminfo
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return round(kb / (1024*1024), 2)
        except Exception:
            pass
    return 0.0

# VRAM estimation model
# base_vram_gb per model family + per-pixel cost
MODEL_VRAM_BASE = {
    # id: (base_gb, gb_per_mp_frame-ish scale)
}

def estimate_vram(model_id, width=512, height=512, num_frames=16, dtype="fp16"):
    """Return estimated VRAM in GB for a generation job."""
    # Per-model base estimates (weights) in GB for fp16
    base = {
        "svd-xt": 14.0,
        "svd": 10.0,
        "cogvideox-2b": 12.0,
        "cogvideox-5b": 22.0,
        "hunyuan-video": 42.0,
        "mochi-1": 36.0,
        "ltx-video": 12.0,
        "wan-2.1-1.3b": 8.0,
        "wan-2.1-14b": 40.0,
        "animatediff": 8.0,
        "zeroscope": 6.0,
        "modelscope": 8.0,
        "stable-video-diffusion-img2vid": 14.0,
        "open-sora": 24.0,
        "pyramid-flow": 20.0,
        "cogvideox-2b-i2v": 12.0,
    }.get(model_id, 10.0)

    # activation memory scales with resolution and frames
    pixels = width * height * num_frames
    # ~ bytes per pixel activation (rough): fp16 ~ 4 bytes effective after tiling
    act_gb = (pixels / 1e6) * 0.05  # 0.05 GB per megapixel-frame
    if dtype == "fp32":
        base *= 2.0
        act_gb *= 2.0
    elif dtype == "int8":
        base *= 0.6
        act_gb *= 0.9
    elif dtype == "int4":
        base *= 0.35
        act_gb *= 0.8
    # attention/overhead
    overhead = 1.5
    total = base + act_gb + overhead
    return round(total, 2)

def fits(vram_needed, available):
    return vram_needed <= available * 0.92  # leave headroom
