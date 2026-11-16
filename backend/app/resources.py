"""Live machine resource usage (adapted from starr_mx resources module)."""
import os, subprocess, shutil, time
from pathlib import Path

try:
    import psutil
    _PSUTIL = True
except Exception:
    _PSUTIL = False

_last_cpu = {"t": 0, "percent": None, "perCore": None}

def _cpu_sample():
    global _last_cpu
    now = time.time()
    if _PSUTIL:
        # psutil.cpu_percent with interval=None returns since last call
        pct = psutil.cpu_percent(interval=None)
        per = psutil.cpu_percent(interval=None, percpu=True)
        cores = psutil.cpu_count(logical=True) or (os.cpu_count() or 1)
        return {"percent": round(pct), "cores": cores, "perCore": [round(x) for x in per], "loadAvg1": round(os.getloadavg()[0], 2) if hasattr(os, "getloadavg") else 0.0}
    # fallback
    cores = os.cpu_count() or 1
    return {"percent": None, "cores": cores, "perCore": [None]*cores, "loadAvg1": 0.0}

def _ram_sample():
    if _PSUTIL:
        vm = psutil.virtual_memory()
        total = round(vm.total / 1048576)
        used = round((vm.total - vm.available) / 1048576)
        free = round(vm.available / 1048576)
        return {"totalMB": total, "usedMB": used, "freeMB": free, "percent": round(vm.percent)}
    # /proc/meminfo
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k] = int(v.split()[0])
        total = info["MemTotal"] // 1024
        avail = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
        used = total - avail
        return {"totalMB": total, "usedMB": used, "freeMB": avail, "percent": round(used/total*100) if total else 0}
    except Exception:
        return {"totalMB": 0, "usedMB": 0, "freeMB": 0, "percent": 0}

def _amd_vram_total_mb():
    try:
        for e in Path("/sys/class/drm").iterdir():
            if not (e.name.startswith("card") and e.name[4:].isdigit()): continue
            vendor = (e/"device"/"vendor").read_text().strip()
            if vendor != "0x1002": continue
            raw = (e/"device"/"mem_info_vram_total").read_text().strip()
            bytes_ = int(raw)
            if bytes_ > 0:
                return round(bytes_ / 1048576)
    except Exception:
        pass
    return None

def _gpu_sample():
    # NVIDIA
    if shutil.which("nvidia-smi"):
        try:
            raw = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
                text=True, timeout=4,
            )
            rows = [r.split(",") for r in raw.strip().splitlines() if r.strip()]
            utils = [float(r[0]) for r in rows]
            used = sum(float(r[1]) for r in rows)
            total = sum(float(r[2]) for r in rows)
            name_raw = subprocess.check_output(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], text=True, timeout=4).strip().splitlines()
            name = name_raw[0] if name_raw else "NVIDIA GPU"
            return {"available": True, "vendor": "nvidia", "reason": None, "name": name, "count": len(rows),
                    "percent": round(sum(utils)/len(utils)) if utils else 0,
                    "memUsedMB": round(used), "memTotalMB": round(total)}
        except Exception as e:
            pass
    # AMD
    try:
        Path("/dev/kfd").stat()
        amd_present = True
    except Exception:
        amd_present = False
    if amd_present:
        # try radeontop one-shot
        node = None
        try:
            for e in Path("/sys/class/drm").iterdir():
                if not (e.name.startswith("card") and e.name[4:].isdigit()): continue
                vendor = (e/"device"/"vendor").read_text().strip()
                if vendor != "0x1002": continue
                nodes = list((e/"device"/"drm").iterdir()) if (e/"device"/"drm").exists() else []
                render = [n.name for n in nodes if n.name.startswith("renderD")]
                if render:
                    candidate = f"/dev/dri/{render[0]}"
                    if Path(candidate).exists():
                        node = candidate
                        break
        except Exception:
            pass
        total_mb = _amd_vram_total_mb()
        util = None
        used_mb = None
        reason = None
        if node and shutil.which("radeontop"):
            try:
                out = subprocess.check_output(
                    ["radeontop", "-d", "-", "-l", "1", "-p", node],
                    text=True, timeout=6, stderr=subprocess.STDOUT,
                )
                # parse last gpu line
                lines = [l for l in out.splitlines() if "gpu" in l and "%" in l]
                line = lines[-1] if lines else ""
                import re
                m = re.search(r"gpu\s+([0-9.]+)%", line)
                if m: util = float(m.group(1))
                vm = re.search(r"vram\s+[0-9.]+%\s+([0-9.]+)mb", line, re.I)
                if vm: used_mb = float(vm.group(1))
                if re.search(r"cannot access gpu registers|failed to open drm node|no vram support", out, re.I):
                    reason = "radeontop reported unreadable registers"
                # bogus unanimity check
                counters = re.findall(r"[a-z]{2,3}\s+([0-9.]+)%", line)
                if len(counters) >= 8 and len(set(counters)) == 1:
                    util = None
                    used_mb = None
                    reason = "radeontop reported identical 100% readings for every counter"
            except Exception as e:
                reason = str(e)[:120]
        # device name
        name = None
        try:
            for e in Path("/sys/class/drm").iterdir():
                if not (e.name.startswith("card") and e.name[4:].isdigit()): continue
                vendor = (e/"device"/"vendor").read_text().strip()
                if vendor != "0x1002": continue
                pn = e/"device"/"product_name"
                if pn.exists():
                    name = pn.read_text().strip() or None
                break
            if not name:
                try:
                    out = subprocess.check_output(["lspci"], text=True, timeout=4)
                    for line in out.splitlines():
                        if "AMD" in line and ("VGA" in line or "Display" in line or "3D" in line):
                            # extract after colon-ish
                            if ":" in line:
                                name = line.split(":", 2)[-1].strip()
                            if "[" in name and "]" in name:
                                name = name[name.rfind("[")+1:name.rfind("]")]
                            break
                except Exception:
                    pass
            if not name:
                name = "AMD GPU"
        except Exception:
            pass
        if node is None:
            reason = reason or "The AMD card has no DRM node — the driver could not start it."
        return {"available": True, "vendor": "amd", "reason": reason, "name": name, "count": 1,
                "percent": (None if util is None else round(util)),
                "memUsedMB": (None if used_mb is None else round(used_mb)),
                "memTotalMB": total_mb}
    # Intel (integrated or Arc)
    try:
        from pathlib import Path as _P
        intel_found = False
        intel_name = "Intel Integrated Graphics"
        intel_vram = None
        for e in _P("/sys/class/drm").iterdir():
            if not (e.name.startswith("card") and e.name[4:].isdigit()):
                continue
            vf = e / "device" / "vendor"
            if not vf.exists() or vf.read_text().strip() != "0x8086":
                continue
            intel_found = True
            vt = e / "device" / "mem_info_vram_total"
            if vt.exists():
                try:
                    intel_vram = int(vt.read_text().strip()) // 1048576
                    intel_name = "Intel Arc GPU"
                except Exception:
                    pass
            break
        if intel_found:
            # try intel_gpu_top for live util
            util = None
            if shutil.which("intel_gpu_top"):
                try:
                    out = subprocess.check_output(
                        ["intel_gpu_top", "-s", "100", "-o", "-"],
                        text=True, timeout=4, stderr=subprocess.DEVNULL,
                    )
                    # best-effort: not parsed; leave None
                except Exception:
                    pass
            return {"available": True, "vendor": "intel", "reason": None if intel_vram else "no live counters (intel_gpu_top not installed)",
                    "name": intel_name, "count": 1,
                    "percent": util, "memUsedMB": None, "memTotalMB": intel_vram}
    except Exception:
        pass

    # no gpu
    return {"available": False, "vendor": None, "reason": "no GPU detected", "name": None, "count": 0,
            "percent": None, "memUsedMB": None, "memTotalMB": None}

# CPU model
def _cpu_model():
    try:
        return (Path("/proc/cpuinfo").read_text().splitlines()[4].split(":",1)[1].strip() if False else None)
    except Exception:
        return None
    return None

def resource_report():
    cpu = _cpu_sample()
    import platform
    cpu["model"] = platform.processor() or "CPU"
    if cpu["model"] in ("", "unknown"):
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    cpu["model"] = line.split(":",1)[1].strip()
                    break
        except Exception:
            pass
    ram = _ram_sample()
    gpu = _gpu_sample()
    return {"cpu": cpu, "ram": ram, "gpu": gpu, "at": int(time.time()*1000)}
