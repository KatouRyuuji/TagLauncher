"""单测挂起诊断：写出进程树/线程/最后命令，必要时结束应用以松开 Playwright。

不拉长 CI 步骤总 timeout。原生调用栈在无调试器的 runner 上通常拿不到；
有线程名与 CPU，没有栈时不能把挂起根因说成已证实。
"""
from __future__ import annotations

import json
import os
import signal
import time
from pathlib import Path

from . import procmem

# 长用例实测：钉住空闲约 308s，两窗隐藏约 156s，50k 性能健康时约 70–200s。
# 12 分钟只拦住「卡死直到步骤 45 分钟被杀」，健康路径过得去。
HANG_AFTER_S = 720


def _image_path(pid: int) -> str | None:
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    k32.OpenProcess.restype = wintypes.HANDLE
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        buf = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buf))
        Query = getattr(k32, "QueryFullProcessImageNameW", None)
        if Query is None:
            return None
        Query.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        Query.restype = wintypes.BOOL
        if not Query(h, 0, buf, ctypes.byref(size)):
            return None
        return buf.value
    finally:
        k32.CloseHandle(h)


def find_app_roots(sandbox_root: Path) -> list[int]:
    """找出镜像路径落在本沙箱里的 tag-launcher 进程。"""
    root = str(sandbox_root).replace("/", "\\").lower()
    out: list[int] = []
    try:
        procs = procmem._processes()
    except Exception:
        return out
    for pid, _ppid, exe in procs:
        if exe.lower() != "tag-launcher.exe":
            continue
        path = _image_path(pid) or ""
        if root in path.replace("/", "\\").lower():
            out.append(pid)
    return out


def snapshot(root_pids: list[int]) -> dict:
    pids: list[int] = []
    tree_errors: list[str] = []
    for root in root_pids:
        try:
            pids.extend(p for p, _ in procmem.tree(root))
        except Exception as e:  # noqa: BLE001
            pids.append(root)
            tree_errors.append(str(e))
    pids = list(dict.fromkeys(pids))
    try:
        roles = {str(k): v for k, v in procmem.roles(pids).items()}
    except Exception as e:  # noqa: BLE001
        roles = {"error": str(e)}
    cpu: dict = {}
    try:
        if root_pids:
            cpu = {str(pid): {"exe": exe, "cpu_s": s} for pid, (exe, s) in procmem.tree_cpu(root_pids[0]).items()}
    except Exception as e:  # noqa: BLE001
        cpu = {"error": str(e)}
    try:
        threads = {str(tid): v for tid, v in procmem.threads(pids).items()}
    except Exception as e:  # noqa: BLE001
        threads = {"error": str(e)}
    return {
        "at": time.time(),
        "root_pids": root_pids,
        "tree_errors": tree_errors,
        "roles": roles,
        "cpu": cpu,
        "threads": threads,
        "native_stacks": None,
        "native_stacks_reason": "CI runner 无调试器；此处只记录线程名/CPU/唤醒，不能当作已证实的挂起根因",
    }


def write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def kill_roots(root_pids: list[int]) -> list[dict]:
    """结束应用进程树，让卡在 Playwright 同步调用里的主线程得以报错并进入拆卸。"""
    out = []
    for pid in root_pids:
        rec = {"pid": pid, "ok": False}
        try:
            os.kill(pid, signal.SIGTERM)
            rec["ok"] = True
        except Exception as e:  # noqa: BLE001
            rec["error"] = str(e)
        out.append(rec)
    return out


def page_state(session) -> dict:
    """仅在 Playwright 所在线程调用。"""
    info: dict = {}
    try:
        if session.page is not None and not session.page.is_closed():
            info["main_url"] = session.page.url
            info["main_title"] = session.page.title()
            info["last_ipc"] = session.page.evaluate(
                "() => window.__e2e && window.__e2e.calls.filter(c => c.cmd !== 'get_items').slice(-5)"
            )
    except Exception as e:  # noqa: BLE001
        info["main_error"] = f"{type(e).__name__}: {e}"
    try:
        pages = []
        if session.browser is not None:
            for ctx in session.browser.contexts:
                for p in ctx.pages:
                    rec = {"url": p.url, "closed": p.is_closed()}
                    if not p.is_closed() and "quick.html" in (p.url or ""):
                        try:
                            rec["visible"] = p.evaluate(
                                "() => window.__TAURI__.window.getCurrentWindow().isVisible()"
                            )
                            rec["ready"] = p.evaluate("() => document.readyState")
                        except Exception as e:  # noqa: BLE001
                            rec["eval_error"] = f"{type(e).__name__}: {e}"
                    pages.append(rec)
        info["pages"] = pages
    except Exception as e:  # noqa: BLE001
        info["pages_error"] = f"{type(e).__name__}: {e}"
    return info
