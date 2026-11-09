"""Win32 真实输入与窗口查询（ctypes，无第三方依赖）。

坐标一律为物理像素：模块加载时把本进程设为 Per-Monitor-V2 DPI 感知。
"""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
except Exception:
    pass

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_MOVE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x1, 0x2, 0x4
MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_VIRTUALDESK = 0x8000, 0x4000
KEYEVENTF_KEYUP = 0x2
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 76, 77, 78, 79
WM_NCHITTEST = 0x84
HT = {1: "CLIENT", 2: "CAPTION", 10: "LEFT", 11: "RIGHT", 12: "TOP", 13: "TOPLEFT", 14: "TOPRIGHT",
      15: "BOTTOM", 16: "BOTTOMLEFT", 17: "BOTTOMRIGHT", 0: "NOWHERE", 18: "BORDER"}
ULONG_PTR = ctypes.c_size_t


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD)]


def _send(*inputs: INPUT) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    if user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise OSError(ctypes.get_last_error(), "SendInput 被拒（可能有 UAC/锁屏/前台限制）")


def _abs(x: int, y: int) -> tuple[int, int]:
    vx, vy = user32.GetSystemMetrics(SM_XVIRTUALSCREEN), user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    vw, vh = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN), user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    return round((x - vx) * 65535 / (vw - 1)), round((y - vy) * 65535 / (vh - 1))


def mouse_move(x: int, y: int) -> None:
    dx, dy = _abs(x, y)
    inp = INPUT(type=INPUT_MOUSE)
    inp.u.mi = MOUSEINPUT(dx, dy, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0, 0)
    _send(inp)


def _button(flag: int) -> None:
    inp = INPUT(type=INPUT_MOUSE)
    inp.u.mi = MOUSEINPUT(0, 0, 0, flag, 0, 0)
    _send(inp)


def mouse_down() -> None:
    _button(MOUSEEVENTF_LEFTDOWN)


def mouse_up() -> None:
    _button(MOUSEEVENTF_LEFTUP)


def click(x: int, y: int, pause: float = 0.05) -> None:
    mouse_move(x, y)
    time.sleep(pause)
    bad: list = []
    _check_cursor(x, y, bad)
    if bad:
        raise InputInterference(f"点击前光标被移走（真实鼠标干扰？）期望/实际：{bad}")
    mouse_down()
    time.sleep(pause)
    mouse_up()


def double_click(x: int, y: int) -> None:
    click(x, y, 0.03)
    time.sleep(0.06)
    click(x, y, 0.03)


class InputInterference(AssertionError):
    """注入期间光标不在我们放的位置：有人同时在动真实鼠标。"""


def _clamp_to_desktop(x: int, y: int) -> tuple[int, int]:
    vx, vy = user32.GetSystemMetrics(SM_XVIRTUALSCREEN), user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    vw, vh = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN), user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    return min(max(x, vx), vx + vw - 1), min(max(y, vy), vy + vh - 1)


def _check_cursor(x: int, y: int, bad: list) -> None:
    ex, ey = _clamp_to_desktop(x, y)
    cx, cy = cursor_pos()
    if abs(cx - ex) > 3 or abs(cy - ey) > 3:
        bad.append(((ex, ey), (cx, cy)))


def drag(x0: int, y0: int, x1: int, y1: int, steps: int = 25, hold: float = 0.15, step_pause: float = 0.015) -> None:
    bad: list = []
    mouse_move(x0, y0)
    time.sleep(0.12)
    _check_cursor(x0, y0, bad)
    mouse_down()
    time.sleep(hold)
    for i in range(1, steps + 1):
        x, y = round(x0 + (x1 - x0) * i / steps), round(y0 + (y1 - y0) * i / steps)
        mouse_move(x, y)
        time.sleep(step_pause)
        _check_cursor(x, y, bad)
    time.sleep(0.15)
    _check_cursor(x1, y1, bad)
    mouse_up()
    time.sleep(0.3)
    if bad:
        raise InputInterference(f"拖拽期间光标被移走（真实鼠标干扰？）期望/实际：{bad[:3]}")


def key(vk: int, up: bool = False) -> None:
    inp = INPUT(type=INPUT_KEYBOARD)
    inp.u.ki = KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP if up else 0, 0, 0)
    _send(inp)


def cursor_pos() -> tuple[int, int]:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


def set_cursor(x: int, y: int) -> None:
    user32.SetCursorPos(x, y)


# ---------------------------------------------------------------- 窗口
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def windows_of_pid(pid: int, visible_only: bool = True) -> list[int]:
    found: list[int] = []

    def cb(hwnd, _):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and (not visible_only or user32.IsWindowVisible(hwnd)):
            found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def title(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value


def main_window(pid: int, timeout: float = 30, visible: bool = True) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for h in windows_of_pid(pid, visible_only=visible):
            if title(h) == "TagLauncher":
                return h
        time.sleep(0.2)
    raise TimeoutError(f"PID {pid} 没有可见主窗口")


def rect(hwnd: int) -> tuple[int, int, int, int]:
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def client_origin(hwnd: int) -> tuple[int, int]:
    pt = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return pt.x, pt.y


def is_zoomed(hwnd: int) -> bool:
    return bool(user32.IsZoomed(hwnd))


def is_iconic(hwnd: int) -> bool:
    return bool(user32.IsIconic(hwnd))


def is_visible(hwnd: int) -> bool:
    return bool(user32.IsWindowVisible(hwnd))


def foreground() -> int:
    return user32.GetForegroundWindow() or 0


def set_foreground(hwnd: int, timeout: float = 2.0) -> bool:
    """把 hwnd 拉到前台。

    不再用 Alt 轻敲：Alt 单击会让目标窗口进入系统菜单模态循环，WebView2/CDP 随之冻结，
    Playwright 定位器一直等不到结果（阶段一窗口层大面积超时的根因）。
    改为把本线程输入队列临时挂到当前前台线程上（AttachThreadInput），此时
    SetForegroundWindow 不受前台锁限制。
    """
    hwnd = int(hwnd)
    if foreground() == hwnd:
        return True
    kernel32 = ctypes.WinDLL("kernel32")
    me = kernel32.GetCurrentThreadId()
    deadline = time.time() + timeout
    while True:
        fg = foreground()
        fg_tid = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        target_tid = user32.GetWindowThreadProcessId(hwnd, None)
        attached = []
        for tid in {fg_tid, target_tid}:
            if tid and tid != me and user32.AttachThreadInput(me, tid, True):
                attached.append(tid)
        try:
            if is_iconic(hwnd):
                user32.ShowWindow(hwnd, 9)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
            user32.SetActiveWindow(hwnd)
        finally:
            for tid in attached:
                user32.AttachThreadInput(me, tid, False)
        time.sleep(0.05)
        if foreground() == hwnd:
            return True
        if time.time() > deadline:
            return False


def show(hwnd: int, cmd: int) -> None:
    """SW_MINIMIZE=6, SW_RESTORE=9, SW_MAXIMIZE=3"""
    user32.ShowWindow(hwnd, cmd)


def move_window(hwnd: int, x: int, y: int, w: int, h: int) -> None:
    user32.SetWindowPos(hwnd, 0, x, y, w, h, 0x0004 | 0x0010)  # NOZORDER | NOACTIVATE


def hit_test(hwnd: int, x: int, y: int) -> str:
    lp = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
    res = user32.SendMessageW(hwnd, WM_NCHITTEST, 0, lp)
    return HT.get(res, str(res))


def monitor_info(hwnd: int) -> dict:
    hmon = user32.MonitorFromWindow(hwnd, 2)
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
    m, w = mi.rcMonitor, mi.rcWork
    return {"monitor": (m.left, m.top, m.right, m.bottom), "work": (w.left, w.top, w.right, w.bottom),
            "primary": bool(mi.dwFlags & 1)}


def all_work_areas() -> list[tuple[int, int, int, int]]:
    areas: list[tuple[int, int, int, int]] = []
    MonitorEnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC,
                                         ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def cb(hmon, _hdc, _rc, _lp):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
        w = mi.rcWork
        areas.append((w.left, w.top, w.right, w.bottom))
        return True

    user32.EnumDisplayMonitors(0, 0, MonitorEnumProc(cb), 0)
    return areas


def dpi_of(hwnd: int) -> int:
    try:
        return user32.GetDpiForWindow(hwnd)
    except Exception:
        return 96


def countdown(seconds: int = 5, what: str = "窗口层真实输入") -> None:
    print(f"\n[e2e] 即将开始{what}：会接管真实鼠标键盘，请勿操作。", flush=True)
    for i in range(seconds, 0, -1):
        print(f"[e2e]   {i}…", flush=True)
        time.sleep(1)


def client_size(hwnd: int) -> tuple[int, int]:
    r = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    return r.right - r.left, r.bottom - r.top


def root_at(x: int, y: int) -> int:
    """屏幕点 (x, y) 处的顶层窗口（真实输入会落到它上面）。"""
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.WindowFromPoint.restype = wintypes.HWND
    user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetAncestor.restype = wintypes.HWND
    h = user32.WindowFromPoint(wintypes.POINT(x, y))
    return user32.GetAncestor(h, 2) or 0 if h else 0  # GA_ROOT


def class_name(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def ensure_hit(hwnd: int, x: int, y: int, timeout: float = 2.0) -> None:
    """确认 (x, y) 处没有别的窗口挡着 hwnd；被挡时先拉前台再等。只报遮挡窗口的类名（不读其内容）。"""
    deadline = time.monotonic() + timeout
    while True:
        top = root_at(x, y)
        if top == hwnd:
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f"({x},{y}) 被其它窗口遮挡：class={class_name(top)!r}")
        set_foreground(hwnd, 0.5)
        time.sleep(0.1)


def find_edge(hwnd: int, kind: str, span: int = 12) -> tuple[int, int]:
    """在窗口矩形内沿边缘向内扫描，返回 WM_NCHITTEST == kind 的第一个点（物理像素）。"""
    l, t, r, b = rect(hwnd)
    mx, my = (l + r) // 2, (t + b) // 2
    for d in range(0, span):
        pt = {
            "LEFT": (l + d, my), "RIGHT": (r - 1 - d, my), "TOP": (mx, t + d), "BOTTOM": (mx, b - 1 - d),
            "TOPLEFT": (l + d, t + d), "TOPRIGHT": (r - 1 - d, t + d),
            "BOTTOMLEFT": (l + d, b - 1 - d), "BOTTOMRIGHT": (r - 1 - d, b - 1 - d),
        }[kind]
        if hit_test(hwnd, *pt) == kind:
            return pt
    raise AssertionError(f"窗口边缘找不到命中区 {kind}（rect={rect(hwnd)}）")


# ---------------------------------------------------------------- 窗口自身内容截图
def is_cloaked(hwnd: int) -> bool:
    """DWM 尚未合成/已隐藏（DWMWA_CLOAKED）时为 True。"""
    val = ctypes.c_int(0)
    try:
        ctypes.WinDLL("dwmapi").DwmGetWindowAttribute(wintypes.HWND(hwnd), 14, ctypes.byref(val), 4)
    except Exception:
        return False
    return bool(val.value)


def capture_window(hwnd: int):
    """PrintWindow(PW_RENDERFULLCONTENT) 抓取窗口自身渲染内容（不受遮挡影响，也不会截到别的窗口）。

    返回 PIL.Image（RGB），失败返回 None。
    """
    from PIL import Image

    gdi32 = ctypes.WinDLL("gdi32")
    vp = ctypes.c_void_p
    user32.GetWindowDC.restype = vp
    user32.GetWindowDC.argtypes = [wintypes.HWND]
    user32.ReleaseDC.argtypes = [wintypes.HWND, vp]
    user32.PrintWindow.argtypes = [wintypes.HWND, vp, wintypes.UINT]
    gdi32.CreateCompatibleDC.restype = vp
    gdi32.CreateCompatibleDC.argtypes = [vp]
    gdi32.CreateCompatibleBitmap.restype = vp
    gdi32.CreateCompatibleBitmap.argtypes = [vp, ctypes.c_int, ctypes.c_int]
    gdi32.SelectObject.restype = vp
    gdi32.SelectObject.argtypes = [vp, vp]
    gdi32.DeleteObject.argtypes = [vp]
    gdi32.DeleteDC.argtypes = [vp]
    gdi32.GetDIBits.argtypes = [vp, vp, wintypes.UINT, wintypes.UINT, vp, vp, wintypes.UINT]
    w, h = client_size(hwnd)
    l, t, r, b = rect(hwnd)
    ww, wh = r - l, b - t
    if ww <= 0 or wh <= 0:
        return None
    hdc_win = user32.GetWindowDC(hwnd)
    hdc = gdi32.CreateCompatibleDC(hdc_win)
    bmp = gdi32.CreateCompatibleBitmap(hdc_win, ww, wh)
    old = gdi32.SelectObject(hdc, bmp)
    try:
        if not user32.PrintWindow(hwnd, hdc, 2):
            return None

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                        ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                        ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]
        bi = BITMAPINFOHEADER()
        bi.biSize, bi.biWidth, bi.biHeight, bi.biPlanes, bi.biBitCount = ctypes.sizeof(bi), ww, -wh, 1, 32
        buf = ctypes.create_string_buffer(ww * wh * 4)
        gdi32.GetDIBits(hdc, bmp, 0, wh, buf, ctypes.byref(bi), 0)
        img = Image.frombuffer("RGBA", (ww, wh), buf.raw, "raw", "BGRA", 0, 1).convert("RGB")
        cx, cy = client_origin(hwnd)
        ox, oy = cx - l, cy - t
        return img.crop((ox, oy, ox + w, oy + h))
    finally:
        gdi32.SelectObject(hdc, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(hdc)
        user32.ReleaseDC(hwnd, hdc_win)
