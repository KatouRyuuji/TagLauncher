"""临时走查用：记录 DWM / 系统透明效果 / 窗口样式 / 页面实际分支。不合入 PR #67。"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import time
from ctypes import wintypes
from pathlib import Path

# DWM attributes
DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_WINDOW_CORNER_PREFERENCE = 33
DWMWA_SYSTEMBACKDROP_TYPE = 38
DWMWA_CLOAKED = 14
DWMSBT_AUTO, DWMSBT_NONE, DWMSBT_MAINWINDOW, DWMSBT_TRANSIENTWINDOW, DWMSBT_TABBEDWINDOW = 0, 1, 2, 3, 4
BACKDROP_NAME = {0: "AUTO", 1: "NONE", 2: "MAINWINDOW", 3: "TRANSIENTWINDOW", 4: "TABBEDWINDOW"}
GWL_EXSTYLE, GWL_STYLE = -20, -16
WS_EX_LAYERED, WS_EX_TRANSPARENT, WS_EX_COMPOSITED, WS_EX_NOREDIRECTIONBITMAP = 0x00080000, 0x00000020, 0x02000000, 0x00200000
WS_VISIBLE, WS_POPUP, WS_THICKFRAME = 0x10000000, 0x80000000, 0x00040000
SM_REMOTESESSION = 0x1000
SPI_GETCLIENTAREAANIMATION = 0x1042

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)
advapi = None

user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = ctypes.c_long
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetSystemMetrics.restype = ctypes.c_int
user32.EnumChildWindows.restype = wintypes.BOOL
user32.GetParent.argtypes = [wintypes.HWND]
user32.GetParent.restype = wintypes.HWND

dwmapi.DwmGetWindowAttribute.argtypes = [wintypes.HWND, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
dwmapi.DwmGetWindowAttribute.restype = ctypes.c_long
dwmapi.DwmIsCompositionEnabled.argtypes = [ctypes.POINTER(wintypes.BOOL)]
dwmapi.DwmIsCompositionEnabled.restype = ctypes.c_long


def _hr(hr: int) -> str:
    return f"0x{(hr & 0xFFFFFFFF):08X}"


def _text(fn, hwnd, n=512) -> str:
    buf = ctypes.create_unicode_buffer(n)
    fn(hwnd, buf, n)
    return buf.value


def class_name(hwnd: int) -> str:
    return _text(user32.GetClassNameW, hwnd, 256)


def title(hwnd: int) -> str:
    return _text(user32.GetWindowTextW, hwnd, 512)


def rect(hwnd: int) -> list[int]:
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return [r.left, r.top, r.right, r.bottom]


def dwm_get(hwnd: int, attr: int) -> dict:
    val = ctypes.c_uint(0)
    hr = dwmapi.DwmGetWindowAttribute(hwnd, attr, ctypes.byref(val), 4)
    out = {"hr": _hr(hr), "ok": hr == 0}
    if hr == 0:
        out["value"] = int(val.value)
        if attr == DWMWA_SYSTEMBACKDROP_TYPE:
            out["name"] = BACKDROP_NAME.get(int(val.value), f"unknown:{val.value}")
    return out


def win_styles(hwnd: int) -> dict:
    style = user32.GetWindowLongW(hwnd, GWL_STYLE) & 0xFFFFFFFF
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & 0xFFFFFFFF
    return {
        "hwnd": int(hwnd),
        "class": class_name(hwnd),
        "title": title(hwnd),
        "rect": rect(hwnd),
        "visible": bool(user32.IsWindowVisible(hwnd)),
        "style": style,
        "exstyle": ex,
        "layered": bool(ex & WS_EX_LAYERED),
        "ex_transparent": bool(ex & WS_EX_TRANSPARENT),
        "ex_composited": bool(ex & WS_EX_COMPOSITED),
        "ex_noredirectionbitmap": bool(ex & WS_EX_NOREDIRECTIONBITMAP),
        "ws_visible": bool(style & WS_VISIBLE),
        "dwm_backdrop": dwm_get(hwnd, DWMWA_SYSTEMBACKDROP_TYPE),
        "dwm_dark": dwm_get(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE),
        "dwm_corner": dwm_get(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE),
        "dwm_cloaked": dwm_get(hwnd, DWMWA_CLOAKED),
    }


def children(hwnd: int) -> list[dict]:
    found: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _lp):
        found.append(h)
        return True

    user32.EnumChildWindows(hwnd, cb, 0)
    return [win_styles(h) for h in found[:24]]


def enum_pid_windows(pid: int) -> list[dict]:
    from win import win32 as w
    out = []
    try:
        for h in w.windows_of_pid(pid, visible_only=False):
            d = win_styles(h)
            try:
                d["children"] = children(h)
            except Exception as e:
                d["children_error"] = str(e)
            out.append(d)
    except Exception as e:
        return [{"error": str(e)}]
    return out


def _reg_dword(root, path: str, name: str):
    try:
        import winreg
        hive = {"HKCU": winreg.HKEY_CURRENT_USER, "HKLM": winreg.HKEY_LOCAL_MACHINE}[root]
        with winreg.OpenKey(hive, path) as k:
            val, typ = winreg.QueryValueEx(k, name)
            return {"value": val, "type": typ}
    except FileNotFoundError:
        return {"missing": True}
    except Exception as e:
        return {"error": str(e)}


def session_info() -> dict:
    info: dict = {
        "sm_remotesession": bool(user32.GetSystemMetrics(SM_REMOTESESSION)),
        "sessionname": os.environ.get("SESSIONNAME"),
        "computername": os.environ.get("COMPUTERNAME"),
    }
    try:
        pid = kernel32.GetCurrentProcessId()
        sid = wintypes.DWORD()
        kernel32.ProcessIdToSessionId(pid, ctypes.byref(sid))
        info["session_id"] = int(sid.value)
    except Exception as e:
        info["session_id_error"] = str(e)
    # WTS 协议：0=控制台，1=旧版，2=RDP
    try:
        wts = ctypes.WinDLL("wtsapi32")
        WTSClientProtocolType = 16
        buf = ctypes.c_void_p()
        length = wintypes.DWORD()
        wts.WTSQuerySessionInformationW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_int,
            ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.DWORD),
        ]
        wts.WTSQuerySessionInformationW.restype = wintypes.BOOL
        wts.WTSFreeMemory.argtypes = [ctypes.c_void_p]
        if wts.WTSQuerySessionInformationW(None, 0xFFFFFFFF, WTSClientProtocolType, ctypes.byref(buf), ctypes.byref(length)):
            proto = ctypes.cast(buf, ctypes.POINTER(ctypes.c_ushort)).contents.value if buf else None
            wts.WTSFreeMemory(buf)
            info["wts_client_protocol"] = proto
            info["wts_protocol_name"] = {0: "console", 1: "legacy", 2: "rdp"}.get(proto, f"other:{proto}")
    except Exception as e:
        info["wts_error"] = str(e)
    return info


def composition() -> dict:
    enabled = wintypes.BOOL(0)
    hr = dwmapi.DwmIsCompositionEnabled(ctypes.byref(enabled))
    return {"hr": _hr(hr), "enabled": bool(enabled.value)}


def spi_client_anim() -> dict:
    val = wintypes.BOOL(0)
    user32.SystemParametersInfoW.argtypes = [wintypes.UINT, wintypes.UINT, ctypes.c_void_p, wintypes.UINT]
    user32.SystemParametersInfoW.restype = wintypes.BOOL
    ok = bool(user32.SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, ctypes.byref(val), 0))
    return {"ok": ok, "enabled": bool(val.value)}


def gpu_and_os() -> dict:
    out: dict = {}
    try:
        ps = (
            "Get-CimInstance Win32_OperatingSystem | "
            "Select-Object Caption,Version,BuildNumber,ProductType | ConvertTo-Json -Compress; "
            "Write-Output '---'; "
            "Get-CimInstance Win32_VideoController | "
            "Select-Object Name,DriverVersion,AdapterRAM,PNPDeviceID,CurrentHorizontalResolution,CurrentVerticalResolution,Availability | ConvertTo-Json -Compress; "
            "Write-Output '---'; "
            "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,HypervisorPresent | ConvertTo-Json -Compress"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=30, encoding="utf-8", errors="replace",
        )
        parts = (r.stdout or "").split("---")
        keys = ["os", "gpu", "computer"]
        for i, chunk in enumerate(parts[:3]):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                out[keys[i]] = json.loads(chunk)
            except Exception:
                out[keys[i]] = chunk[:2000]
        if r.returncode:
            out["powershell_rc"] = r.returncode
            out["powershell_err"] = (r.stderr or "")[:500]
    except Exception as e:
        out["error"] = str(e)
    return out


def system_probe() -> dict:
    return {
        "t": time.time(),
        "session": session_info(),
        "dwm_composition": composition(),
        "client_area_animation": spi_client_anim(),
        "registry": {
            "HKCU_EnableTransparency": _reg_dword(
                "HKCU", r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency"),
            "HKCU_ColorPrevalence": _reg_dword(
                "HKCU", r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "ColorPrevalence"),
            "HKCU_SystemUsesLightTheme": _reg_dword(
                "HKCU", r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "SystemUsesLightTheme"),
            "HKCU_DWM_ForceEffectMode": _reg_dword("HKCU", r"Software\Microsoft\Windows\DWM", "ForceEffectMode"),
            "HKCU_DWM_Composition": _reg_dword("HKCU", r"Software\Microsoft\Windows\DWM", "Composition"),
            "HKLM_EnableTransparency": _reg_dword(
                "HKLM", r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency"),
            "HKLM_DisableTransparency": _reg_dword(
                "HKLM", r"SOFTWARE\Policies\Microsoft\Windows\System", "DisableAcrylicBackgroundOnLogon"),
        },
        "env": {
            "TL_DWM_DIAG": os.environ.get("TL_DWM_DIAG"),
            "UX_GLASS_ONLY": os.environ.get("UX_GLASS_ONLY"),
        },
        "machine": gpu_and_os(),
    }


_DOM_JS = r"""() => {
  const html = document.documentElement;
  const attrs = {};
  for (const a of html.attributes) attrs[a.name] = a.value;
  const cs = (el, pseudo) => {
    if (!el) return null;
    const s = getComputedStyle(el, pseudo);
    return {
      backgroundColor: s.backgroundColor,
      backgroundImage: (s.backgroundImage || '').slice(0, 400),
      opacity: s.opacity,
      backdropFilter: s.backdropFilter || s.webkitBackdropFilter || '',
      borderRadius: s.borderRadius,
    };
  };
  const shell = document.querySelector('.quick-shell, .pin-shell');
  return {
    url: location.href,
    attrs,
    hasAcrylic: html.hasAttribute('data-acrylic'),
    scheme: html.getAttribute('data-scheme'),
    quickHidden: html.hasAttribute('data-quick-hidden'),
    surface: html.getAttribute('data-surface') || (shell && shell.getAttribute('data-surface')),
    html: cs(html),
    body: cs(document.body),
    root: cs(document.getElementById('root')),
    shell: cs(shell),
    shellBefore: cs(shell, '::before'),
  };
}"""


def page_probe(page) -> dict:
    if page is None:
        return {"skipped": "no page"}
    try:
        return page.evaluate(_DOM_JS)
    except Exception as e:
        return {"error": str(e)}


def load_apply_log() -> list:
    path = os.environ.get("TL_DWM_DIAG")
    if not path:
        return []
    p = Path(path)
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            rows.append({"raw": line})
    return rows


def record_snapshot(out_dir: Path, app, *, page=None, label: str, pid: int) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    snap = {
        "label": label,
        "t": time.time(),
        "pid": pid,
        "windows": enum_pid_windows(pid),
        "page": page_probe(page),
        "apply_log": load_apply_log(),
    }
    # highlight the likely quick/pin hwnd by title
    for w in snap["windows"]:
        t = (w.get("title") or "")
        if "快速" in t or "搜索" in t or "钉" in t or "TagLauncher" in t:
            w["role_guess"] = "app-window"
    path = out_dir / f"glass-diag-{label}.json"
    path.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"path": str(path), "has_acrylic": (snap["page"] or {}).get("hasAcrylic"),
            "apply_n": len(snap["apply_log"])}


def write_system_probe(out_dir: Path) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "glass-diag-system.json"
    path.write_text(json.dumps(system_probe(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path
