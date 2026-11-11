"""窗口层补充（E-WIN-09/10/20、E-ENV-07/10、E-LCH-03/08、E-OBJ-07）。

本目录全部自动打 physical_input，默认跳过；只在用户同意后用 --allow-physical-input 集中跑一次。
关闭外部窗口时只关“本用例启动后新出现”的窗口，绝不碰用户已有窗口。
"""
from __future__ import annotations

import ctypes
import subprocess
import time
from ctypes import wintypes

import pytest

from harness import files
from harness.app import wait_until
from win import win32

from .conftest import Win

user32 = ctypes.windll.user32 if hasattr(ctypes, "windll") else None
WM_CLOSE = 0x0010
VK_LWIN, VK_LEFT, VK_RIGHT, VK_UP, VK_DOWN = 0x5B, 0x25, 0x27, 0x26, 0x28


def top_windows_by_class(cls: str) -> set[int]:
    out: set[int] = set()
    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(h, _):
        if user32.IsWindowVisible(h) and win32.class_name(h) == cls:
            out.add(int(h))
        return True
    user32.EnumWindows(proc(cb), 0)
    return out


def close_new(cls: str, before: set[int], timeout: float = 10) -> int:
    new: set[int] = set()
    def appeared():
        new.update(top_windows_by_class(cls) - before)
        return bool(new)
    wait_until(appeared, timeout, f"未出现新的 {cls} 窗口")
    for h in new:
        user32.PostMessageW(h, WM_CLOSE, 0, 0)
    return len(new)


def win_combo(vk: int):
    win32.key(VK_LWIN); win32.key(vk); win32.key(vk, up=True); win32.key(VK_LWIN, up=True)


def half(w: Win, side: str) -> bool:
    work = win32.monitor_info(w.hwnd)["work"]
    l, t, r, b = win32.rect(w.hwnd)
    mid = (work[0] + work[2]) // 2
    tol = 20
    if side == "left":
        return abs(l - work[0]) <= tol and abs(r - mid) <= tol
    return abs(l - mid) <= tol and abs(r - work[2]) <= tol


@pytest.mark.case("E-WIN-09")
def test_aero_snap_halves(win):
    before = win32.rect(win.hwnd)
    win.front()
    win.act("Win+← 未半屏", lambda: win_combo(VK_LEFT), lambda: half(win, "left"))
    win.page.wait_for_timeout(500)
    win32.key(0x1B); win32.key(0x1B, up=True)  # 关掉 Snap Assist
    win.front()
    win.act("Win+→ 未半屏", lambda: win_combo(VK_RIGHT), lambda: half(win, "right") or half(win, "left") is False)
    win.page.wait_for_timeout(500)
    # 拖出还原原尺寸
    x, y = win.title_point()
    win.drag(x, y, x - 200, y + 150, steps=40)
    win.page.wait_for_timeout(500)
    l, t, r, b = win32.rect(win.hwnd)
    assert abs((r - l) - (before[2] - before[0])) <= 8 and abs((b - t) - (before[3] - before[1])) <= 8


@pytest.mark.case("E-WIN-10")
def test_snap_top_maximize(win):
    win.front()
    x, y = win.title_point()
    work = win32.monitor_info(win.hwnd)["work"]
    win.act("拖到顶边未最大化", lambda: win.drag(x, y, x, work[1], steps=40), lambda: win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(400)
    win.front()
    win.act("Win+↓ 未还原", lambda: win_combo(VK_DOWN), lambda: not win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(400)
    win.front()
    win.act("Win+↑ 未最大化", lambda: win_combo(VK_UP), lambda: win32.is_zoomed(win.hwnd))
    win32.show(win.hwnd, 9)


@pytest.mark.case("E-WIN-20")
def test_resize_no_blank_flash(win):
    """拖右边缘连续改尺寸，逐帧截屏：大面积纯白/纯黑（WebView 没来得及重绘）的帧 ≤ 2。

    截的是屏幕上窗口所在区域（用户实际看到的），不用 PrintWindow：无 GPU 的虚拟机上
    PrintWindow(PW_RENDERFULLCONTENT) 抓 WebView2 合成内容整帧为黑（CI 实测 40/40），量不到闪烁。
    先截一帧静止画面校验截图方式本身有效。"""
    import numpy as np
    from PIL import ImageGrab

    def grab():
        return ImageGrab.grab(bbox=win32.rect(win.hwnd), all_screens=True)

    def blank(img) -> tuple[float, float]:
        a = np.asarray(img.convert("L"))
        return float((a > 250).mean()), float((a < 5).mean())

    win.front()
    time.sleep(0.3)
    base = blank(grab())
    print(f"E-WIN-20 baseline white={base[0]:.2f} black={base[1]:.2f}")
    assert base[0] <= 0.6 and base[1] <= 0.6, f"静止画面已判为空白，截图方式无效：{base}"
    ex, ey = win32.find_edge(win.hwnd, "RIGHT")
    frames = []
    win32.mouse_move(ex, ey); win32.mouse_down()
    try:
        for i in range(40):
            win32.mouse_move(ex + (i % 20) * 8 - 80, ey)
            time.sleep(0.05)
            frames.append(grab())
    finally:
        win32.mouse_up()
    stats = [blank(f) for f in frames]
    bad = sum(1 for w, b in stats if w > 0.6 or b > 0.6)
    print(f"E-WIN-20 frames={len(frames)} bad={bad} worst_white={max(w for w, _ in stats):.2f} worst_black={max(b for _, b in stats):.2f}")
    assert bad <= 2, f"{bad}/{len(frames)} 帧为大面积纯白/纯黑"


@pytest.mark.case("E-ENV-07")
def test_second_instance_restores_maximized(win, sandbox):
    win.act("最大化", lambda: win.click(*win.button("最大化")), lambda: win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(300)
    win.act("最小化", lambda: win.click(*win.button("最小化")), lambda: win32.is_iconic(win.hwnd))
    subprocess.run([str(sandbox.exe)], cwd=sandbox.bin, env=sandbox.env(None), timeout=30, capture_output=True)
    wait_until(lambda: not win32.is_iconic(win.hwnd), 5, "未恢复")
    assert win32.is_zoomed(win.hwnd), "应恢复为最大化"
    win32.show(win.hwnd, 9)


@pytest.mark.case("E-ENV-10")
def test_startup_failure_messagebox(real_input, sandbox):
    save = sandbox.default_save_dir
    files.write(save / "taglauncher.db", b"garbage " * 512)  # 坏库且无备份
    sandbox.install_exe()
    before = top_windows_by_class("#32770")
    proc = subprocess.Popen([str(sandbox.exe)], cwd=sandbox.bin, env=sandbox.env(None))
    try:
        box = set()
        def appeared():
            box.update(h for h in top_windows_by_class("#32770") - before if win32.windows_of_pid(proc.pid) and h in win32.windows_of_pid(proc.pid))
            return bool(box)
        wait_until(appeared, 20, "未出现本进程的原生 MessageBox")
        for h in box:
            user32.PostMessageW(h, WM_CLOSE, 0, 0)
        proc.wait(timeout=15)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.poll() is not None, "关闭弹窗后进程不应残留"


@pytest.mark.case("E-LCH-03")
def test_ps1_opens_with_association(win, sandbox):
    app = win.app
    p = files.write(sandbox.files / "脚本.ps1", "Set-Content -Path \"$PSScriptRoot\\ps1.marker\" -Value ran\n")
    app.seed([p])
    before = top_windows_by_class("Notepad")
    app.invoke("launch_item", {"id": app.item("脚本.ps1")["id"]})
    close_new("Notepad", before)
    assert not (p.parent / "ps1.marker").exists(), "默认关联应打开编辑器而非执行脚本"
    wait_until(lambda: app.item("脚本.ps1")["last_used_at"], 5)


@pytest.mark.case("E-LCH-08")
def test_txt_opens_editor(win, sandbox):
    app = win.app
    p = files.write(sandbox.files / "说明.txt", "hello")
    app.seed([p])
    before = top_windows_by_class("Notepad")
    app.invoke("launch_item", {"id": app.item("说明.txt")["id"]})
    assert close_new("Notepad", before) >= 1


@pytest.mark.case("E-OBJ-07")
def test_real_ole_drop(win):
    pytest.skip("需要可控的 OLE 拖放源窗体（不能借用用户的资源管理器窗口）；OLE 数据通路已由 UI 层 drag-drop 事件桩覆盖")
