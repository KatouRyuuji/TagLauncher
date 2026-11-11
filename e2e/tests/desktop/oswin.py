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


# ---------------------------------------------------------------- 资源管理器窗口（Shell 自动化 + UIA）
_FIND_WINDOW_PS = r"""
$sh = New-Object -ComObject Shell.Application
$w = $null
foreach ($x in $sh.Windows()) {
  try { if ($x.Document.Folder.Self.Path -eq $env:TL_DIR) { $w = $x; break } } catch {}
}
"""


def _ps(script: str, **env) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command",
                        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + script],
                       capture_output=True, timeout=60, env={**__import__("os").environ, **env})
    out = r.stdout.decode("utf-8", "replace").strip()
    if r.returncode != 0:
        raise RuntimeError(f"PowerShell 失败：{r.stderr.decode('utf-8', 'replace')[:500]} / {out[:300]}")
    return out


class ExplorerWindow:
    """真实的资源管理器窗口：打开文件夹、按名字选中项、取某项在屏幕上的矩形。"""

    def __init__(self, folder: Path):
        self.folder = Path(folder)
        subprocess.Popen(["explorer.exe", str(self.folder)])
        deadline = time.time() + 30
        self.hwnd = 0
        while time.time() < deadline and not self.hwnd:
            out = _ps(_FIND_WINDOW_PS + "if ($w) { $w.HWND }", TL_DIR=str(self.folder))
            self.hwnd = int(out) if out.strip().isdigit() else 0
            if not self.hwnd:
                time.sleep(0.5)
        assert self.hwnd, f"资源管理器窗口没有打开：{self.folder}"

    def select(self, names: list[str]) -> None:
        script = _FIND_WINDOW_PS + r"""
$names = $env:TL_NAMES -split "`n"
$first = $true
foreach ($n in $names) {
  $it = $w.Document.Folder.ParseName($n)
  if ($first) { $w.Document.SelectItem($it, 1 + 4 + 8 + 16); $first = $false } else { $w.Document.SelectItem($it, 1) }
}
@($w.Document.SelectedItems() | ForEach-Object { $_.Path }) | ConvertTo-Json -Compress
"""
        out = _ps(script, TL_DIR=str(self.folder), TL_NAMES="\n".join(names))
        got = json.loads(out or "[]")
        got = [got] if isinstance(got, str) else got
        assert sorted(Path(p).name for p in got) == sorted(names), f"选中项不对：{got}"

    def item_rect(self, name: str) -> tuple[int, int, int, int]:
        """UIA 找列表项（显示名可能隐藏扩展名）的屏幕矩形（物理像素）。"""
        script = r"""
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$env:TL_HWND)
foreach ($n in @($env:TL_NAME, [IO.Path]::GetFileNameWithoutExtension($env:TL_NAME))) {
  $c1 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $n)
  $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.AndCondition($c1, $c2)))
  if ($el) { $r = $el.Current.BoundingRectangle; "{0},{1},{2},{3}" -f [int]$r.Left, [int]$r.Top, [int]$r.Right, [int]$r.Bottom; break }
}
"""
        out = _ps(script, TL_HWND=str(self.hwnd), TL_NAME=name)
        assert out.count(",") == 3, f"UIA 没找到列表项 {name}：{out!r}"
        l, t, r, b = (int(v) for v in out.split(","))
        return l, t, r, b

    def close(self) -> None:
        user32.PostMessageW(self.hwnd, 0x10, 0, 0)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
