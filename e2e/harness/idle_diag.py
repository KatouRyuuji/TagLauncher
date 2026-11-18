"""经隐藏窗口 WM_COPYDATA 采集原生 FrameId 关联快照。断 CDP 之后不得再 connect_over_cdp。"""
from __future__ import annotations

import ctypes
import json
import os
import time
from ctypes import wintypes
from pathlib import Path

WM_COPYDATA = 0x004A
COPYDATA_MAGIC = 0x544C4944
CLASS_NAME = "TagLauncherIdleDiag"
TITLE = "TagLauncher IdleDiag"


class COPYDATASTRUCT(ctypes.Structure):
    _fields_ = [
        ("dwData", ctypes.c_size_t),
        ("cbData", wintypes.DWORD),
        ("lpData", ctypes.c_void_p),
    ]


def snapshot_path(pid: int, generation: int) -> Path:
    return Path(os.environ.get("TEMP") or os.environ.get("TMP") or ".") / (
        f"TagLauncher-idle-diag-{pid}-{generation}.json"
    )


def capture(pid: int, tag: str, timeout: float = 10.0) -> dict:
    """向本进程的诊断窗口请求一次快照并等待落盘。失败返回 ok=False，不重建 CDP。"""
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = wintypes.LPARAM
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    hwnd = user32.FindWindowW(CLASS_NAME, TITLE)
    if not hwnd:
        return {"ok": False, "tag": tag, "error": "native idle diag window not found"}
    wnd_pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wnd_pid))
    if int(wnd_pid.value) != int(pid):
        return {
            "ok": False,
            "tag": tag,
            "error": f"idle diag window pid {wnd_pid.value} ≠ app pid {pid}",
        }

    payload = json.dumps({"tag": tag}, ensure_ascii=False).encode("utf-8")
    buf = ctypes.create_string_buffer(payload)
    cds = COPYDATASTRUCT(COPYDATA_MAGIC, len(payload), ctypes.cast(buf, ctypes.c_void_p))
    gen = int(user32.SendMessageW(hwnd, WM_COPYDATA, 0, ctypes.addressof(cds)))
    if gen <= 0:
        return {"ok": False, "tag": tag, "error": f"WM_COPYDATA rejected or returned {gen}"}

    path = snapshot_path(pid, gen)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file() and path.stat().st_size > 0:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                time.sleep(0.05)
                continue
            if int(data.get("generation") or 0) == gen:
                data["path"] = str(path)
                return data
        time.sleep(0.05)
    return {
        "ok": False,
        "tag": tag,
        "generation": gen,
        "error": f"timed out waiting for {path}",
        "path": str(path),
    }
