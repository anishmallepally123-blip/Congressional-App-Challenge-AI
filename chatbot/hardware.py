"""
Finds out what this computer can handle: memory (RAM), graphics card (GPU) and
its memory (VRAM), and free disk space. Works on Windows, Mac and Linux using
only Python's standard library and tools that come with the system.

Every check is wrapped so that a failure just means "unknown", never a crash.
"""

import glob
import os
import platform
import shutil
import subprocess

GB = 1024 ** 3


def _run(cmd, timeout=5):
    """Run a command and return its output, or "" if it fails or isn't installed."""
    try:
        flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: no console flash on Windows
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=flags)
        return out.stdout if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


# ---------- Memory (RAM) ----------

def _ram_windows():
    import ctypes

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
    return stat.ullTotalPhys


def _ram_mac():
    return int(_run(["sysctl", "-n", "hw.memsize"]).strip() or 0)


def _ram_linux():
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    return 0


def total_ram_bytes():
    try:
        system = platform.system()
        if system == "Windows":
            return _ram_windows()
        if system == "Darwin":
            return _ram_mac()
        return _ram_linux()
    except Exception:
        return 0


# ---------- Graphics cards (GPU and VRAM) ----------

def _nvidia_gpus():
    """NVIDIA cards, on any system that has the NVIDIA driver installed."""
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    gpus = []
    for line in out.strip().splitlines():
        name, _, mib = line.rpartition(",")
        try:
            gpus.append({"name": name.strip(), "vram_gb": round(int(mib) / 1024, 1)})
        except ValueError:
            pass
    return gpus


def _windows_gpus():
    """Other cards on Windows (AMD, Intel), read from the driver's registry entry."""
    # Newer drivers store the card's memory as a 64-bit number (qwMemorySize). Older ones, and many
    # AMD drivers, only have MemorySize, sometimes saved as raw bytes, so read whichever is there.
    script = (
        "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\"
        "{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | "
        "ForEach-Object { "
        "$m = $_.'HardwareInformation.qwMemorySize'; "
        "if ($null -eq $m) { $m = $_.'HardwareInformation.MemorySize' }; "
        "if ($m -is [byte[]]) { if ($m.Length -ge 8) { $m = [BitConverter]::ToUInt64($m, 0) } "
        "elseif ($m.Length -ge 4) { $m = [BitConverter]::ToUInt32($m, 0) } else { $m = '' } }; "
        "$_.DriverDesc + '|' + $m }"
    )
    out = _run(["powershell", "-NoProfile", "-Command", script], timeout=10)
    gpus = []
    for line in out.strip().splitlines():
        name, _, size = line.partition("|")
        if name.strip():
            vram = int(size) / GB if size.strip().isdigit() else 0
            gpus.append({"name": name.strip(), "vram_gb": round(vram, 1)})
    return gpus


def _linux_amd_gpus():
    gpus = []
    for path in glob.glob("/sys/class/drm/card*/device/mem_info_vram_total"):
        try:
            with open(path) as f:
                gpus.append({"name": "AMD Radeon", "vram_gb": round(int(f.read()) / GB, 1)})
        except (OSError, ValueError):
            pass
    return gpus


def _usable_by_ollama(gpu):
    """Ollama can speed up with NVIDIA and AMD cards, but not Intel's built-in graphics."""
    name = gpu["name"].lower()
    return gpu["vram_gb"] >= 2 and any(k in name for k in ("nvidia", "geforce", "rtx", "quadro", "tesla", "amd", "radeon"))


def _disk_free_gb():
    """Free space where Ollama keeps models (checked fresh each time, since downloads use it up)."""
    models_dir = os.environ.get("OLLAMA_MODELS") or os.path.expanduser("~")
    try:
        return round(shutil.disk_usage(models_dir).free / GB, 1)
    except OSError:
        return None


# ---------- Putting it together ----------

_cache = None


def detect():
    """Return a summary of this computer. The result is cached after the first call."""
    global _cache
    if _cache:
        return dict(_cache, disk_free_gb=_disk_free_gb())

    system = platform.system()
    ram_gb = round(total_ram_bytes() / GB, 1)
    apple_silicon = system == "Darwin" and platform.machine() == "arm64"

    gpus = _nvidia_gpus()
    if apple_silicon:
        chip = _run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip() or "Apple Silicon"
        # Apple chips share one pool of memory between the processor and graphics.
        gpus = [{"name": chip, "vram_gb": ram_gb, "shared": True}]
    elif not gpus and system == "Windows":
        gpus = _windows_gpus()
    elif not gpus and system == "Linux":
        gpus = _linux_amd_gpus()

    for gpu in gpus:
        gpu["usable"] = bool(gpu.get("shared")) or _usable_by_ollama(gpu)
    best_vram = max((g["vram_gb"] for g in gpus if g["usable"] and not g.get("shared")), default=0)

    _cache = {
        "os": {"Darwin": "macOS"}.get(system, system),
        "ram_gb": ram_gb,
        "cpu_cores": os.cpu_count() or 0,
        "gpus": gpus,
        "vram_gb": best_vram,
        "unified_memory": apple_silicon,
    }
    return dict(_cache, disk_free_gb=_disk_free_gb())


if __name__ == "__main__":
    import json
    print(json.dumps(detect(), indent=2))
