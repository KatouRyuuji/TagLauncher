"""desktop 作业专用的 Win32 探针：图标加载、置顶、托盘图标定位、弹出菜单读取、右键点击、前台替身进程。"""
from __future__ import annotations

import ctypes
import json
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path

from win import win32

user32 = ctypes.WinDLL("user32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x8
MN_GETHMENU = 0x01E1
MF_BYPOSITION = 0x400
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x8, 0x10

user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.GetMenuItemCount.argtypes = [wintypes.HMENU]
user32.GetMenuStringW.argtypes = [wintypes.HMENU, wintypes.UINT, wintypes.LPWSTR, ctypes.c_int, wintypes.UINT]
user32.GetMenuItemRect.argtypes = [wintypes.HWND, wintypes.HMENU, wintypes.UINT, ctypes.POINTER(wintypes.RECT)]
shell32.ExtractIconExW.restype = wintypes.UINT
shell32.ExtractIconExW.argtypes = [wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(wintypes.HICON),
                                   ctypes.POINTER(wintypes.HICON), wintypes.UINT]


def icon_loadable(spec: str) -> dict:
    """注册表 Icon 值（`"path",index`）→ 用 ExtractIconExW 真正把图标加载出来。"""
    path, _, idx = spec.rpartition(",")
    path = path.strip().strip('"')
    index = int(idx or 0)
    total = shell32.ExtractIconExW(path, -1, None, None, 0)
    large, small = wintypes.HICON(), wintypes.HICON()
    got = shell32.ExtractIconExW(path, index, ctypes.byref(large), ctypes.byref(small), 1)
    ok = bool(large.value) and bool(small.value)
    for h in (large, small):
        if h.value:
            user32.DestroyIcon(h)
    return {"path": path, "index": index, "total": total, "extracted": got, "ok": ok}


def is_topmost(hwnd: int) -> bool:
    return bool(user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST)


def window_pid(hwnd: int) -> int:
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def window_by_title(pid: int, title: str, visible_only: bool = True) -> int | None:
    for h in win32.windows_of_pid(pid, visible_only=visible_only):
        if win32.title(h) == title:
            return h
    return None


def foreground_info() -> dict:
    fg = win32.foreground()
    return {"hwnd": fg, "pid": window_pid(fg) if fg else 0, "title": win32.title(fg) if fg else "",
            "class": win32.class_name(fg) if fg else ""}


# ---------------------------------------------------------------- 托盘
class NOTIFYICONIDENTIFIER(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT),
                ("guidItem", ctypes.c_byte * 16)]


shell32.Shell_NotifyIconGetRect.restype = ctypes.c_long
shell32.Shell_NotifyIconGetRect.argtypes = [ctypes.POINTER(NOTIFYICONIDENTIFIER), ctypes.POINTER(wintypes.RECT)]


def tray_icon_rect(pid: int) -> tuple[int, int, int, int] | None:
    """在该进程的（含隐藏）窗口 × 小范围 uID 中找到已登记的通知区图标，返回其屏幕矩形。"""
    for hwnd in win32.windows_of_pid(pid, visible_only=False):
        for uid in range(0, 64):
            nid = NOTIFYICONIDENTIFIER(ctypes.sizeof(NOTIFYICONIDENTIFIER), hwnd, uid)
            r = wintypes.RECT()
            if shell32.Shell_NotifyIconGetRect(ctypes.byref(nid), ctypes.byref(r)) == 0:
                return r.left, r.top, r.right, r.bottom
    return None


def right_click(x: int, y: int) -> None:
    win32.mouse_move(x, y)
    time.sleep(0.05)
    for flag in (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP):
        inp = win32.INPUT(type=win32.INPUT_MOUSE)
        inp.u.mi = win32.MOUSEINPUT(0, 0, 0, flag, 0, 0)
        win32._send(inp)
        time.sleep(0.03)


def popup_menus(pid: int) -> list[int]:
    return [h for h in win32.windows_of_pid(pid) if win32.class_name(h) == "#32768"]


def menu_items(menu_hwnd: int) -> list[dict]:
    hmenu = user32.SendMessageW(menu_hwnd, MN_GETHMENU, 0, 0)
    out = []
    for i in range(max(user32.GetMenuItemCount(hmenu), 0)):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetMenuStringW(hmenu, i, buf, 256, MF_BYPOSITION)
        r = wintypes.RECT()
        user32.GetMenuItemRect(None, hmenu, i, ctypes.byref(r))
        out.append({"text": buf.value, "rect": (r.left, r.top, r.right, r.bottom)})
    return out


def center(r) -> tuple[int, int]:
    return (r[0] + r[2]) // 2, (r[1] + r[3]) // 2


def press(*vks: int) -> None:
    """按下组合键再逆序抬起（真实 SendInput）。"""
    for vk in vks:
        win32.key(vk)
        time.sleep(0.02)
    for vk in reversed(vks):
        win32.key(vk, up=True)
        time.sleep(0.02)


VK = {"CTRL": 0x11, "ALT": 0x12, "SHIFT": 0x10, "F11": 0x7A, "F12": 0x7B}


# ---------------------------------------------------------------- 前台替身
class FgHelper:
    """前台替身（见 fg_helper.py）：一个独立的 Tk 进程，充当资源管理器 / 全屏游戏。"""

    def __init__(self, env: dict | None = None, fullscreen: bool = False):
        # env 用沙箱环境：替身 ShellExecute 起的 tag-launcher.exe 继承它，不碰真实数据目录
        args = [sys.executable, str(Path(__file__).with_name("fg_helper.py"))] + (["--fullscreen"] if fullscreen else [])
        self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", env=env)
        info = json.loads(self.proc.stdout.readline())
        self.hwnd, self.pid = info["hwnd"], info["pid"]

    def focus(self) -> None:
        """拉到前台并在窗口内真实点一下，让替身进程成为「最近有输入的前台进程」。"""
        assert win32.set_foreground(self.hwnd, timeout=5), f"前台替身未能到前台：{foreground_info()}"
        l, t, r, b = win32.rect(self.hwnd)
        win32.click((l + r) // 2, (t + b) // 2)
        time.sleep(0.2)
        assert win32.foreground() == self.hwnd, f"点击后前台不是替身：{foreground_info()}"

    def call(self, **cmd) -> dict:
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()
        out = json.loads(self.proc.stdout.readline())
        assert out.get("ok"), out
        return out

    def startfile(self, path, verb: str = "open", args: str = "") -> None:
        self.call(op="startfile", path=str(path), verb=verb, args=args)

    def close(self) -> None:
        try:
            self.call(op="quit")
        except Exception:  # noqa: BLE001
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


# ---------------------------------------------------------------- 剪贴板（CF_HDROP）
CF_UNICODETEXT, CF_HDROP = 13, 15
user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.GetClipboardData.restype = wintypes.HANDLE
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.SetClipboardData.restype = wintypes.HANDLE
user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalSize.restype = ctypes.c_size_t
kernel32.GlobalSize.argtypes = [wintypes.HGLOBAL]
shell32.DragQueryFileW.restype = wintypes.UINT
shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]


class _Clip:
    def __enter__(self):
        for _ in range(50):
            if user32.OpenClipboard(None):
                return self
            time.sleep(0.05)
        raise OSError("OpenClipboard 失败")

    def __exit__(self, *exc):
        user32.CloseClipboard()


def clipboard_files() -> dict:
    """读剪贴板：CF_HDROP 文件表（DragQueryFileW）与 Preferred DropEffect。"""
    with _Clip():
        out = {"files": [], "drop_effect": None, "text": None}
        h = user32.GetClipboardData(CF_HDROP)
        if h:
            n = shell32.DragQueryFileW(h, 0xFFFFFFFF, None, 0)
            for i in range(n):
                size = shell32.DragQueryFileW(h, i, None, 0) + 1
                buf = ctypes.create_unicode_buffer(size)
                shell32.DragQueryFileW(h, i, buf, size)
                out["files"].append(buf.value)
        fmt = user32.RegisterClipboardFormatW("Preferred DropEffect")
        h = user32.GetClipboardData(fmt)
        if h:
            p = kernel32.GlobalLock(h)
            out["drop_effect"] = ctypes.c_uint32.from_address(p).value
            kernel32.GlobalUnlock(h)
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if h:
            p = kernel32.GlobalLock(h)
            out["text"] = ctypes.wstring_at(p)
            kernel32.GlobalUnlock(h)
        return out


def _set(fmt: int, data: bytes) -> None:
    h = kernel32.GlobalAlloc(0x2, len(data))
    p = kernel32.GlobalLock(h)
    ctypes.memmove(p, data, len(data))
    kernel32.GlobalUnlock(h)
    assert user32.SetClipboardData(fmt, h), "SetClipboardData 失败"


def set_clipboard_files(paths: list[str]) -> None:
    body = b"".join(p.encode("utf-16-le") + b"\0\0" for p in paths) + b"\0\0"
    header = (20).to_bytes(4, "little") + bytes(8) + (0).to_bytes(4, "little") + (1).to_bytes(4, "little")
    with _Clip():
        user32.EmptyClipboard()
        _set(CF_HDROP, header + body)


def set_clipboard_text(text: str) -> None:
    with _Clip():
        user32.EmptyClipboard()
        _set(CF_UNICODETEXT, text.encode("utf-16-le") + b"\0\0")


def clear_clipboard() -> None:
    with _Clip():
        user32.EmptyClipboard()

# ---------------------------------------------------------------- 通知区溢出（Win11 系任务栏）
OVERFLOW_CLASS = "TopLevelWindowForOverflowXamlIsland"
NOTIFY_SETTINGS = r"Control Panel\NotifyIconSettings"


def promote_tray_icon(exe: str) -> list[str]:
    """Win11 系任务栏：新图标默认收进溢出区（EnableAutoTray 不再生效）。等同用户在设置里把它
    「显示在任务栏上」：HKCU\\Control Panel\\NotifyIconSettings\\<id> 的 IsPromoted=1（资源管理器实时读取）。
    返回改动的子键；没有该键（Win10 系）返回空。"""
    import winreg
    changed = []
    try:
        root = winreg.OpenKey(winreg.HKEY_CURRENT_USER, NOTIFY_SETTINGS)
    except OSError:
        return changed
    with root:
        i = 0
        while True:
            try:
                name = winreg.EnumKey(root, i)
            except OSError:
                break
            i += 1
            try:
                with winreg.OpenKey(root, name, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
                    path = str(winreg.QueryValueEx(k, "ExecutablePath")[0])
                    if path.replace('/', '\\').rsplit('\\', 1)[-1].lower() == Path(exe).name.lower():
                        winreg.SetValueEx(k, "IsPromoted", 0, winreg.REG_DWORD, 1)
                        changed.append(name)
            except OSError:
                continue
    return changed


_UIA_FIND = r'''
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]{hwnd})
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {{
  if ($e.Current.Name -like '*{name}*') {{
    $r = $e.Current.BoundingRectangle
    if ($r.Width -gt 0) {{ "{{0}},{{1}},{{2}},{{3}}" -f [int]$r.Left, [int]$r.Top, [int]$r.Right, [int]$r.Bottom; break }}
  }}
}}
'''


def overflow_icon_rect(name: str = "TagLauncher") -> tuple[int, int, int, int] | None:
    """溢出区浮层打开时，经 UI Automation 找到名称含 name 的图标按钮。"""
    fg = foreground_info()
    if fg["class"] != OVERFLOW_CLASS:
        return None
    out = subprocess.run(["powershell", "-NoProfile", "-Command", _UIA_FIND.format(hwnd=fg["hwnd"], name=name)],
                         capture_output=True, text=True, timeout=30).stdout.strip()
    if not out:
        return None
    l, t, r, b = (int(x) for x in out.splitlines()[0].split(","))
    return l, t, r, b


def click_tray_icon(pid: int, right: bool = False, overflow: bool | None = None) -> dict:
    """点托盘图标。图标收在溢出区时 Shell_NotifyIconGetRect 给的是溢出箭头：左键点它打开浮层，
    再经 UIA 点浮层里的图标。overflow=None 时由左键结果判断（只用于左键）；右键须传入已知的 overflow。"""
    rect = tray_icon_rect(pid)
    assert rect, "通知区没有找到图标"
    x, y = center(rect)
    info = {"rect": rect, "overflow": bool(overflow)}
    if right and not overflow:
        right_click(x, y)
        return info
    win32.click(x, y)
    if overflow is False:
        return info
    time.sleep(0.8)
    if foreground_info()["class"] != OVERFLOW_CLASS:
        assert not right, f"溢出浮层没有打开：{foreground_info()}"
        return info
    r = wait_overflow_icon()
    info.update(overflow=True, overflow_rect=r)
    (right_click if right else win32.click)(*center(r))
    return info


def wait_overflow_icon(timeout: float = 8) -> tuple[int, int, int, int]:
    end = time.time() + timeout
    while time.time() < end:
        if r := overflow_icon_rect():
            return r
        time.sleep(0.3)
    raise AssertionError(f"溢出浮层里没有找到 TagLauncher 图标：{foreground_info()}")
