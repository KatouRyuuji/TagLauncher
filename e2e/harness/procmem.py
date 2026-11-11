"""进程树内存（Win32 只读）：应用主进程 + 全部子孙进程（WebView2 浏览器/渲染/GPU 进程）。

PrivateUsage = 进程独占的提交内存（与任务管理器「提交大小」同口径），WorkingSet = 常驻物理内存。
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)

TH32CS_SNAPPROCESS = 0x2
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                ("szExeFile", ctypes.c_wchar * 260)]


class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t)]


k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
k32.OpenProcess.restype = wintypes.HANDLE


def _processes() -> list[tuple[int, int, str]]:
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    out = []
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(e)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            out.append((e.th32ProcessID, e.th32ParentProcessID, e.szExeFile))
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    return out


def create_time(pid: int) -> int | None:
    """进程创建时刻（FILETIME 100ns）；打不开（受保护/已退出）返回 None。"""
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        c, e, k, u = (wintypes.FILETIME() for _ in range(4))
        if not k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
            return None
        return (c.dwHighDateTime << 32) | c.dwLowDateTime
    finally:
        k32.CloseHandle(h)


def tree(root_pid: int) -> list[tuple[int, str]]:
    """root 及其子孙。th32ParentProcessID 只是「创建时的父 PID」，父进程退出后该 PID 会被复用：
    若某个子孙复用了系统早期进程（如已退出的 smss.exe）的 PID，按 PPID 递归会把 wininit/services/
    Runner/WindowsTerminal… 整个系统拉进来（PR62 desktop-release IDLE_CPU 9.8% 即此误归属，
    tag-launcher 自身 0.109 s）。故要求子进程创建时刻不早于父进程（标准的 PID 复用判别）。"""
    procs = _processes()
    born: dict[int, int | None] = {}

    def t(pid: int) -> int | None:
        if pid not in born:
            born[pid] = create_time(pid)
        return born[pid]

    keep, frontier = {root_pid}, [root_pid]
    while frontier:
        parent = frontier.pop()
        for pid, ppid, _ in procs:
            if ppid == parent and pid not in keep and pid != ppid:
                pt, ct = t(parent), t(pid)
                if pt is None or ct is None or ct < pt:
                    continue
                keep.add(pid)
                frontier.append(pid)
    return [(pid, exe) for pid, _, exe in procs if pid in keep]


def memory(pid: int) -> tuple[int, int] | None:
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        return None
    try:
        c = PROCESS_MEMORY_COUNTERS_EX()
        c.cb = ctypes.sizeof(c)
        if not psapi.GetProcessMemoryInfo(h, ctypes.byref(c), c.cb):
            return None
        return int(c.PrivateUsage), int(c.WorkingSetSize)
    finally:
        k32.CloseHandle(h)


def tree_memory(root_pid: int) -> dict:
    """{private_mb, working_set_mb, processes: [...]}"""
    rows, priv, ws = [], 0, 0
    for pid, exe in tree(root_pid):
        m = memory(pid)
        if m is None:
            continue
        priv += m[0]
        ws += m[1]
        rows.append({"pid": pid, "exe": exe, "private_mb": round(m[0] / 2**20, 1), "ws_mb": round(m[1] / 2**20, 1)})
    return {"private_mb": round(priv / 2**20, 1), "working_set_mb": round(ws / 2**20, 1), "processes": rows}


def cpu_seconds(pid: int) -> float | None:
    """进程累计 CPU 时间（内核 + 用户，秒）。"""
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        c, e, k, u = (wintypes.FILETIME() for _ in range(4))
        if not k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
            return None

        def ft(x) -> int:
            return (x.dwHighDateTime << 32) | x.dwLowDateTime
        return (ft(k) + ft(u)) / 1e7
    finally:
        k32.CloseHandle(h)


def tree_cpu(root_pid: int) -> dict[int, tuple[str, float]]:
    """{pid: (exe, cpu_seconds)}：应用进程树每个进程的累计 CPU 时间。"""
    out = {}
    for pid, exe in tree(root_pid):
        s = cpu_seconds(pid)
        if s is not None:
            out[pid] = (exe, s)
    return out
