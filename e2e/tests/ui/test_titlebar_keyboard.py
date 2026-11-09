"""E-WIN-18：标题栏窗口按钮键盘可达（CDP 键盘事件，不接管物理输入；窗口状态经 Win32 只读查询）。"""
from __future__ import annotations

import pytest

from harness.app import wait_until
from win import win32

FOCUS_JS = """() => { const a = document.activeElement; if (!a) return null;
  const cs = getComputedStyle(a);
  return {name: a.getAttribute('aria-label'), fv: a.matches(':focus-visible'),
          ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'}; }"""


def tab_to(app, name, limit=120):
    pg = app.page
    pg.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    for _ in range(limit):
        pg.keyboard.press("Tab")
        f = pg.evaluate(FOCUS_JS)
        if f and f["name"] == name:
            return f
    raise AssertionError(f"Tab {limit} 次未到达「{name}」")


@pytest.mark.visible_window  # 最大化窗口必然铺满显示器
@pytest.mark.case("E-WIN-18")
def test_titlebar_buttons_keyboard(app):
    app.close_welcome(3000)
    hwnd = win32.main_window(app.proc.pid)
    for name in ("最小化", "最大化", "关闭"):
        f = tab_to(app, name)
        assert f["fv"] and f["ring"], (name, f)
    # 最大化 → 还原
    tab_to(app, "最大化")
    app.page.keyboard.press("Enter")
    wait_until(lambda: win32.is_zoomed(hwnd), 5, "Enter 未最大化")
    f = tab_to(app, "还原")
    app.page.keyboard.press("Enter")
    wait_until(lambda: not win32.is_zoomed(hwnd), 5, "Enter 未还原")
    # 最小化
    tab_to(app, "最小化")
    app.page.keyboard.press("Enter")
    wait_until(lambda: win32.is_iconic(hwnd), 5, "Enter 未最小化")
    win32.show(hwnd, 9)
    wait_until(lambda: not win32.is_iconic(hwnd), 5)
    # 关闭（主窗口关闭行为：隐藏到托盘或退出，任一即生效）
    tab_to(app, "关闭")
    app.page.keyboard.press("Enter")
    wait_until(lambda: app.proc.poll() is not None or not win32.is_visible(hwnd), 8, "Enter 未关闭窗口")
