"""让 E2E 启动的应用窗口不打扰用户：放到所有显示器之外、不激活、不进任务栏。

产品主窗口以隐藏状态创建（tauri.conf visible=false），前端主题就绪后才 show()。
本模块在进程启动后立即轮询它的顶层窗口（含隐藏的），在 show 之前：
  - 扩展样式加 WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE、去掉 WS_EX_APPWINDOW（无任务栏按钮、不抢焦点）
  - SetWindowPos(SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE) 移到 OFFSCREEN
之后在整个会话期间守护：产品（restore_state / clamp_window_to_work_area / 用例改尺寸）
把窗口挪回屏幕内时再移走。最大化窗口无法移出屏幕，记录为违规（这类用例应标 visible_window）。
"""
from __future__ import annotations

import ctypes
import os
import threading
import time
from ctypes import wintypes

OFFSCREEN = (-25000, -25000)
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000
WS_EX_NOACTIVATE = 0x08000000
SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE, SWP_FRAMECHANGED = 0x1, 0x4, 0x10, 0x20

ENABLED = os.environ.get("TL_E2E_VISIBLE") != "1"

if os.name == "nt":
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.RedrawWindow.argtypes = [wintypes.HWND, ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
    _ENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


_IMG: dict[int, str] = {}


def _image(pid: int) -> str:
    if pid not in _IMG:
        k32 = ctypes.WinDLL("kernel32")
        k32.OpenProcess.restype = wintypes.HANDLE
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        path = ""
        if h:
            buf = ctypes.create_unicode_buffer(1024)
            n = wintypes.DWORD(1024)
            if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
                path = buf.value
            k32.CloseHandle(h)
        _IMG[pid] = path.lower()
    return _IMG[pid]


_SKIP_CLASSES = {"IME", "MSCTFIME UI", "tooltips_class32", "SysShadow"}


def _windows_under(root: str) -> list[int]:
    """可执行文件位于 root（沙箱目录）下的进程的全部顶层窗口（含隐藏的）。覆盖应用自重启后的新进程。"""
    out: list[int] = []

    def cb(h, _):
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if _image(p.value).startswith(root):
            buf = ctypes.create_unicode_buffer(64)
            user32.GetClassNameW(h, buf, 64)
            if buf.value not in _SKIP_CLASSES:  # 输入法/提示等系统辅助窗口不碰
                out.append(int(h))
        return True

    user32.EnumWindows(_ENUM(cb), 0)
    return out


def _rect(h: int) -> tuple[int, int, int, int]:
    r = wintypes.RECT()
    user32.GetWindowRect(h, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def _virtual_screen() -> tuple[int, int, int, int]:
    x, y = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
    return x, y, x + user32.GetSystemMetrics(78), y + user32.GetSystemMetrics(79)


def on_screen(h: int) -> bool:
    """窗口矩形与虚拟桌面（全部显示器的外接矩形）是否相交。"""
    l, t, r, b = _rect(h)
    vl, vt, vr, vb = _virtual_screen()
    return l < vr and r > vl and t < vb and b > vt


def hide_window(h: int) -> None:
    ex = user32.GetWindowLongPtrW(h, GWL_EXSTYLE)
    want = (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW
    if want != ex:
        user32.SetWindowLongPtrW(h, GWL_EXSTYLE, want)
        user32.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | 0x2)
    if on_screen(h) and not user32.IsZoomed(h):
        user32.SetWindowPos(h, 0, OFFSCREEN[0], OFFSCREEN[1], 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)


def nudge_windows(root: str) -> int:
    """屏幕外的 WebView2 偶发不再出帧（rAF 停住，Playwright 的 stable 检查会卡满 30s）：
    把可见窗口宽度 +1 再还原并强制重绘，促使合成器重新出帧。不移动到屏幕内、不激活。"""
    n = 0
    for h in _windows_under(root):
        if not user32.IsWindowVisible(h):
            continue
        l, t, r, b = _rect(h)
        flags = 0x2 | 0x4 | 0x10  # NOMOVE | NOZORDER | NOACTIVATE
        user32.SetWindowPos(h, 0, 0, 0, r - l + 1, b - t, flags)
        user32.SetWindowPos(h, 0, 0, 0, r - l, b - t, flags)
        user32.RedrawWindow(h, None, None, 0x1 | 0x100 | 0x80)  # INVALIDATE | UPDATENOW | ALLCHILDREN
        n += 1
    return n


class Guard:
    """守护沙箱内进程的全部顶层窗口；记录屏幕上可见的采样与前台窗口变化。"""

    def __init__(self, root, interval: float = 0.01):
        self.root, self.interval = str(root).lower().rstrip("\\") + "\\", interval
        self.stop_evt = threading.Event()
        self.fg0 = int(user32.GetForegroundWindow() or 0)
        self.violations: list[str] = []   # 可见且在屏幕内的采样
        self.fg_stolen = 0                 # 前台窗口变成本进程窗口的采样数
        self.samples = 0
        self.nudges = 0                    # 渲染停帧后补救性“抖一下”窗口的次数
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stop_evt.is_set():
            try:
                mine = _windows_under(self.root)
                fg = int(user32.GetForegroundWindow() or 0)
                for h in mine:
                    hide_window(h)
                    if user32.IsWindowVisible(h) and on_screen(h):
                        self.violations.append(f"{_rect(h)} zoomed={bool(user32.IsZoomed(h))}")
                if fg in mine:
                    self.fg_stolen += 1
                self.samples += 1
            except Exception:
                pass
            time.sleep(self.interval)

    def stop(self):
        self.stop_evt.set()
        self.thread.join(timeout=2)
