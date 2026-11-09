"""窗口层（E-WIN-* / E-ENV-06/13）：真实 SendInput 操作无边框主窗口。

坐标均为物理像素；容差 TOL 覆盖 DPI 取整与系统拖拽阈值。
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from harness.app import wait_until
from win import win32

from .conftest import Win

TOL = 6
STATE = Path(os.environ.get("APPDATA", "")) / "com.taglauncher.app" / ".window-state.json"


def r(w: Win):
    return win32.rect(w.hwnd)


def near(a, b, tol=TOL):
    return abs(a - b) <= tol


def in_work_area(w: Win) -> bool:
    """内容区（客户区）完全落在某个显示器工作区内。"""
    cx, cy = win32.client_origin(w.hwnd)
    cw, ch = win32.client_size(w.hwnd)
    return any(cx >= a[0] - 1 and cy >= a[1] - 1 and cx + cw <= a[2] + 1 and cy + ch <= a[3] + 1
               for a in win32.all_work_areas())


@pytest.mark.case("E-WIN-01", "E-WIN-02", "E-WIN-03", "E-WIN-04")
def test_move_and_resize(win):
    # WIN-01 标题栏拖动
    l0, t0, r0, b0 = r(win)
    x, y = win.title_point()
    win.act("WIN-01 标题栏拖动", lambda: win.drag(x, y, x + 300, y + 80), lambda: r(win) != (l0, t0, r0, b0))
    l, t, rr, b = r(win)
    assert near(l, l0 + 300) and near(t, t0 + 80) and near(rr - l, r0 - l0) and near(b - t, b0 - t0), (r0, (l, t, rr, b))

    # WIN-02 四边：被拖边向内移动，对边不动。窗口有 800×600（逻辑 px）最小尺寸，
    # 同一轴先后两次内缩，所以每次位移取 min(150, 剩余余量/2)，避免撞上最小尺寸被夹住。
    dpr = win.dpr
    # BUG-08 修复后：最小尺寸约束的是内容区 800×600（逻辑 px），外框 = 内容区 + 不可见缩放边框
    _l, _t, _r, _b = r(win)
    _cw, _ch = win32.client_size(win.hwnd)
    min_w, min_h = round(800 * dpr) + (_r - _l - _cw), round(600 * dpr) + (_b - _t - _ch)
    l, t, rr, b = r(win)
    step_x = max(20, min(150, (rr - l - min_w - 2 * TOL) // 2))
    step_y = max(20, min(150, (b - t - min_h - 2 * TOL) // 2))
    for kind, dx, dy, moved in (("RIGHT", -step_x, 0, 2), ("BOTTOM", 0, -step_y, 3),
                                ("LEFT", step_x, 0, 0), ("TOP", 0, step_y, 1)):
        before = r(win)
        px, py = win32.find_edge(win.hwnd, kind)
        win.act(f"WIN-02 {kind}", lambda: win.drag(px, py, px + dx, py + dy), lambda: r(win) != before)
        after = r(win)
        delta = dx or dy
        for i in range(4):
            want = before[i] + delta if i == moved else before[i]
            assert near(after[i], want), (kind, delta, (min_w, min_h), before, after)

    # WIN-03 四角：两条邻边同时动，对角锚点不动。WIN-01/02 已平移并内缩窗口，先复位到
    # 已知位置与尺寸，保证向外拖有屏幕余量、向内拖不撞最小尺寸。
    win.place()
    for kind, d, moved in (("BOTTOMRIGHT", (80, 60), (2, 3)), ("TOPLEFT", (-80, -60), (0, 1)),
                           ("TOPRIGHT", (-60, 60), (2, 1)), ("BOTTOMLEFT", (60, -60), (0, 3))):
        before = r(win)
        assert before[2] - before[0] - 60 >= min_w and before[3] - before[1] - 60 >= min_h, (kind, before)
        px, py = win32.find_edge(win.hwnd, kind)
        win.act(f"WIN-03 {kind}", lambda: win.drag(px, py, px + d[0], py + d[1]), lambda: r(win) != before)
        after = r(win)
        for i in range(4):
            want = before[i] + (d[0] if i in (0, 2) else d[1]) if i in moved else before[i]
            assert near(after[i], want), (kind, before, after)

    # WIN-04 最小尺寸：向内拖到极限
    before = r(win)
    px, py = win32.find_edge(win.hwnd, "BOTTOMRIGHT")
    win.act("WIN-04 拖到最小", lambda: win.drag(px, py, px - 2000, py - 2000, steps=30), lambda: r(win) != before)
    win.page.wait_for_timeout(400)
    l, t, rr, b = r(win)
    assert near(rr - l, min_w) and near(b - t, min_h), ("最小尺寸未生效", (min_w, min_h), (l, t, rr, b))
    vw, vh = win.page.evaluate("[innerWidth, innerHeight]")
    overflow = win.page.evaluate("[document.documentElement.scrollWidth - innerWidth,"
                                 " document.documentElement.scrollHeight - innerHeight]")
    win.app.capture("win-04-min-size")
    assert overflow[0] <= 0 and overflow[1] <= 0, f"最小尺寸下页面溢出 {overflow}"
    assert win.page.locator('[data-region="titlebar"]').get_by_role("button", name="关闭", exact=True).is_visible()
    # BUG-08 已修复（最小尺寸按内容区 800×600 + 不可见边框换算）：原 xfail 改为直接断言（待 Windows 实跑验证）
    assert vw >= 799 and vh >= 599, f"BUG-08：最小窗口下内容区只有 {vw}×{vh} CSS px（< 800×600）"


@pytest.mark.case("E-WIN-05", "E-WIN-07", "E-WIN-08", "E-WIN-06")
def test_maximize_minimize(win):
    # WIN-05 最大化按钮 → 占满工作区但不盖任务栏 → 还原
    before = r(win)
    win.act("最大化按钮未生效", lambda: win.click(*win.button("最大化")), lambda: win32.is_zoomed(win.hwnd))
    work = win32.monitor_info(win.hwnd)["work"]
    cx, cy = win32.client_origin(win.hwnd)
    cw, ch = win32.client_size(win.hwnd)
    assert near(cx, work[0], 2) and near(cy, work[1], 2) and near(cx + cw, work[2], 2) and near(cy + ch, work[3], 2), \
        ((cx, cy, cw, ch), work)
    win.page.wait_for_timeout(300)
    win.act("还原按钮未生效", lambda: win.click(*win.button("还原")), lambda: not win32.is_zoomed(win.hwnd))
    assert all(near(a, b) for a, b in zip(r(win), before)), (before, r(win))

    # WIN-07 双击标题栏 ↔
    win.front()
    win.act("双击标题栏未最大化", lambda: win32.double_click(*win.title_point()), lambda: win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(400)
    win.act("再次双击未还原", lambda: win32.double_click(*win.title_point()), lambda: not win32.is_zoomed(win.hwnd))

    # WIN-08 拖动最大化窗口 → 退出最大化并跟随光标
    win.page.wait_for_timeout(400)
    win.act("WIN-08 最大化", lambda: win.click(*win.button("最大化")), lambda: win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(400)
    x, y = win.title_point()
    win.act("拖动最大化窗口未还原", lambda: win.drag(x, y, x + 40, y + 220, steps=40),
            lambda: not win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(400)
    px, py = win32.cursor_pos()
    l, t, rr, b = r(win)
    cx, cy = win32.client_origin(win.hwnd)
    header = win.page.locator('[data-region="titlebar"]').bounding_box()
    assert l <= px <= rr and cy <= py <= cy + header["height"] * win.dpr + 2, ((px, py), (l, t, rr, b))

    # WIN-06 最小化 → 还原后正常重绘
    win.front()
    win.act("最小化按钮未生效", lambda: win.click(*win.button("最小化")), lambda: win32.is_iconic(win.hwnd))
    win32.show(win.hwnd, 9)
    wait_until(lambda: not win32.is_iconic(win.hwnd), 5)
    win.page.wait_for_timeout(500)
    assert win.page.evaluate("document.visibilityState") == "visible"
    assert win.page.locator('[data-region="root"]').is_visible()
    win.app.capture("win-06-after-restore")


@pytest.mark.case("E-WIN-11")
def test_restart_remembers_rect(win):
    l, t = r(win)[:2]
    win32.move_window(win.hwnd, l + 37, t + 23, 1111, 777)
    win.page.wait_for_timeout(400)
    want = r(win)
    win.app.stop()
    win.app.start()
    hwnd = win32.main_window(win.app.proc.pid)
    got = win32.rect(hwnd)
    assert all(near(a, b, 2) for a, b in zip(got, want)), (want, got)


def _write_state(mutate) -> None:
    data = json.loads(STATE.read_text(encoding="utf-8"))
    mutate(data["main"])
    STATE.write_text(json.dumps(data), encoding="utf-8")


@pytest.mark.case("E-WIN-12", "E-WIN-14")
def test_offscreen_state_clamped(real_input, app_factory):
    app = app_factory()
    app.stop()  # 先正常关闭一次，取得插件真实写出的 state 结构
    assert STATE.exists(), STATE

    def off(m):
        m.update(x=-32000, y=-32000, width=6000, height=4500, maximized=False)
    _write_state(off)
    app.start()
    w = Win(app)
    wait_until(lambda: win32.is_visible(w.hwnd), 10)
    w.page.wait_for_timeout(500)
    assert in_work_area(w), (win32.rect(w.hwnd), win32.all_work_areas())
    # 夹回后仍可拖动
    w.front()
    l0, t0 = r(w)[:2]
    x, y = w.title_point()
    w.act("夹回后拖动", lambda: w.drag(x, y, x + 120, y + 60), lambda: r(w)[:2] != (l0, t0))
    l, t = r(w)[:2]
    assert near(l, l0 + 120) and near(t, t0 + 60), ((l0, t0), (l, t))


@pytest.mark.case("E-WIN-13")
def test_maximized_restart(win):
    win.act("最大化", lambda: win.click(*win.button("最大化")), lambda: win32.is_zoomed(win.hwnd))
    win.page.wait_for_timeout(300)
    win.app.stop()
    assert json.loads(STATE.read_text(encoding="utf-8"))["main"].get("maximized") is True
    win.app.start()
    w = Win(win.app)
    wait_until(lambda: win32.is_zoomed(w.hwnd), 10, "重启后未恢复最大化")
    assert in_work_area(w)
    w.front()
    w.act("还原", lambda: w.click(*w.button("还原")), lambda: not win32.is_zoomed(w.hwnd))
    w.page.wait_for_timeout(300)
    assert in_work_area(w), "还原出的普通态超出工作区"


@pytest.mark.case("E-ENV-06")
def test_second_instance_restores_window(win, sandbox):
    win.act("最小化", lambda: win.click(*win.button("最小化")), lambda: win32.is_iconic(win.hwnd))
    second = subprocess.run([str(sandbox.exe)], cwd=sandbox.bin, env=sandbox.env(None), timeout=30,
                            capture_output=True)
    assert second.returncode == 0, second
    wait_until(lambda: not win32.is_iconic(win.hwnd) and win32.is_visible(win.hwnd), 5, "原窗口未恢复")
    wait_until(lambda: win32.foreground() == win.hwnd, 5, lambda: f"前台={win32.foreground()} 期望={win.hwnd}")
    assert win.app.proc.poll() is None


@pytest.mark.case("E-ENV-13")
def test_close_button_exits(win):
    win.act("关闭按钮未退出", lambda: win.click(*win.button("关闭")), lambda: win.app.proc.poll() is not None,
            timeout=8)
    code = win.app.proc.wait(timeout=15)
    assert code == 0
    assert not win32.windows_of_pid(win.app.proc.pid, visible_only=False)
