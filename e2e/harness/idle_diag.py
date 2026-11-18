"""经隐藏窗口 WM_COPYDATA 采集原生 FrameId 关联快照。断 CDP 之后不得再 connect_over_cdp。

输出目录必须是沙箱 ``app.sb.root / "Temp"``，不要用 pytest 进程自己的 TEMP。
message-only 窗口用 FindWindowExW(HWND_MESSAGE, …) 并按 PID 遍历；发送用有界
SendMessageTimeoutW，避免 UI 挂起时诊断自己挂死。
"""
from __future__ import annotations

import ctypes
import json
import time
from ctypes import wintypes
from pathlib import Path

WM_COPYDATA = 0x004A
COPYDATA_MAGIC = 0x544C4944
CLASS_NAME = "TagLauncherIdleDiag"
TITLE = "TagLauncher IdleDiag"
SMTO_ABORTIFHUNG = 0x0002
SEND_TIMEOUT_MS = 3000
MAX_COPYDATA = 512


class COPYDATASTRUCT(ctypes.Structure):
    _fields_ = [
        ("dwData", ctypes.c_size_t),
        ("cbData", wintypes.DWORD),
        ("lpData", ctypes.c_void_p),
    ]


def _hwnd_message() -> int:
    bits = ctypes.sizeof(wintypes.HWND) * 8
    return (1 << bits) - 3  # HWND_MESSAGE == -3


def snapshot_path(out_dir: Path, pid: int, generation: int) -> Path:
    return Path(out_dir) / f"TagLauncher-idle-diag-{pid}-{generation}.json"


def assess_snapshot(snap: dict | None) -> dict:
    """取证先决：捕获必须成功；身份要么 KNOWN，要么有明确 UNKNOWN 原因，不能把失败当证明。"""
    if not isinstance(snap, dict):
        return {"capture_ok": False, "identity": "failed", "reason": "snapshot missing"}

    err = snap.get("error")
    err_s = str(err or "")
    infra = (
        "not found", "timed out", "timeout", "hung", "rejected", "SendMessageTimeout",
        "out_dir", "diag window", "in-flight",
    )
    has_body = bool(snap.get("windows") is not None or snap.get("generation"))
    if err_s and any(k.lower() in err_s.lower() for k in infra):
        return {"capture_ok": False, "identity": "failed", "reason": err_s}
    if not has_body:
        return {"capture_ok": False, "identity": "failed", "reason": err_s or "empty snapshot"}

    reasons: list[str] = []
    known = 0
    unknown = 0
    for w in snap.get("windows") or []:
        mapping = (w or {}).get("mapping") or {}
        status = mapping.get("status") or w.get("frame_id_status") or ""
        if status == "ok":
            known += 1
        else:
            unknown += 1
            reason = mapping.get("reason") or w.get("frame_id_status") or ""
            if reason:
                reasons.append(f"{w.get('label', '?')}: {reason}")
    pstatus = snap.get("processes_status")
    if pstatus and pstatus != "ok":
        reasons.append(snap.get("processes_reason") or str(pstatus))

    if known and (pstatus in (None, "ok")):
        return {
            "capture_ok": True,
            "identity": "known",
            "reason": None,
            "known_windows": known,
            "unknown_windows": unknown,
        }

    explicit = [r for r in reasons if r and r != "UNKNOWN"]
    if pstatus == "UNKNOWN" and snap.get("processes_reason"):
        explicit = explicit or [snap.get("processes_reason")]
    if explicit:
        return {
            "capture_ok": True,
            "identity": "UNKNOWN",
            "reason": "; ".join(explicit),
            "known_windows": known,
            "unknown_windows": unknown,
            "explicit_unknown": True,
        }
    return {
        "capture_ok": False,
        "identity": "failed",
        "reason": err_s or "ok=false or UNKNOWN mapping without explicit reason (cannot treat as identity proof)",
        "known_windows": known,
        "unknown_windows": unknown,
    }


def find_diag_hwnd(pid: int):
    """FindWindowW 看不到 HWND_MESSAGE 子窗口；必须 FindWindowExW 并按 PID 过滤。"""
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowExW.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    prev = wintypes.HWND(0)
    parent = wintypes.HWND(_hwnd_message())
    while True:
        hwnd = user32.FindWindowExW(parent, prev, CLASS_NAME, TITLE)
        if not hwnd:
            return None
        wnd_pid = wintypes.DWORD(0)
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wnd_pid))
        if int(wnd_pid.value) == int(pid):
            return hwnd
        prev = wintypes.HWND(hwnd)


def capture(pid: int, tag: str, *, out_dir: Path, timeout: float = 10.0) -> dict:
    """向本进程的诊断窗口请求一次快照并等待落盘。失败返回 ok=False，不重建 CDP。"""
    out_dir = Path(out_dir)
    if not str(out_dir):
        return {"ok": False, "tag": tag, "error": "out_dir required (use app.sb.root / 'Temp')"}
    out_dir.mkdir(parents=True, exist_ok=True)

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SendMessageTimeoutW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
        wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t),
    ]
    user32.SendMessageTimeoutW.restype = wintypes.LPARAM

    hwnd = find_diag_hwnd(pid)
    if not hwnd:
        return {"ok": False, "tag": tag, "error": "native idle diag window not found (FindWindowExW HWND_MESSAGE)"}

    payload = json.dumps({"tag": tag}, ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_COPYDATA:
        return {"ok": False, "tag": tag, "error": f"payload exceeds MAX_COPYDATA={MAX_COPYDATA}"}
    buf = ctypes.create_string_buffer(payload)
    cds = COPYDATASTRUCT(COPYDATA_MAGIC, len(payload), ctypes.cast(buf, ctypes.c_void_p))
    result = ctypes.c_size_t(0)
    ok = user32.SendMessageTimeoutW(
        hwnd, WM_COPYDATA, 0, ctypes.addressof(cds),
        SMTO_ABORTIFHUNG, SEND_TIMEOUT_MS, ctypes.byref(result),
    )
    if not ok:
        err = ctypes.get_last_error()
        return {
            "ok": False,
            "tag": tag,
            "error": f"SendMessageTimeoutW timed out or UI hung (err={err})",
        }
    gen = int(result.value)
    if gen <= 0:
        return {"ok": False, "tag": tag, "error": f"WM_COPYDATA rejected or returned {gen}"}

    path = snapshot_path(out_dir, pid, gen)
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
