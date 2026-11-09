"""窗口层：真实 SendInput。会话内只倒计时一次；结束后还原光标与前台窗口。"""
from __future__ import annotations

import os

import pytest

from harness.app import wait_until
from win import win32


@pytest.fixture(autouse=True)
def _visible_windows():
    """窗口层要真实可见、可点的窗口：关掉 harness.stealth 的屏幕外守护。"""
    from harness import app as happ
    happ.STEALTH["on"] = False
    yield
    happ.STEALTH["on"] = True


@pytest.fixture(scope="session")
def real_input(pytestconfig):
    # 双保险：即使绕过收集期门禁（如直接 -p 调用），未显式允许也不接管鼠标键盘
    if not (pytestconfig.getoption("--allow-physical-input") or os.environ.get("TL_E2E_ALLOW_PHYSICAL") == "1"):
        pytest.skip("physical_input：未显式允许接管真实鼠标键盘")
    if os.environ.get("CI") and not os.environ.get("TL_E2E_ALLOW_WINDOW"):
        pytest.skip("CI 无交互桌面：窗口层默认不在 CI 跑（设 TL_E2E_ALLOW_WINDOW=1 强制）")
    cursor, fg = win32.cursor_pos(), win32.foreground()
    win32.countdown(pytestconfig.getoption("--window-countdown"))
    yield
    win32.set_cursor(*cursor)
    if fg:
        try:
            win32.set_foreground(fg)
        except Exception:
            pass


_RETRY_LOG: list[str] = []


@pytest.fixture(scope="session", autouse=True)
def _report_retries(pytestconfig):
    yield
    if _RETRY_LOG:
        out = pytestconfig.rootpath.parent / ".tmp-test" / "e2e" / "window-retries.log"
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("\n".join(_RETRY_LOG), encoding="utf-8")
        except OSError:
            pass


class Win:
    """主窗口 + 页面坐标换算（CSS px → 屏幕物理 px）。"""

    def __init__(self, app):
        self.app = app
        self.hwnd = win32.main_window(app.proc.pid)
        self.page = app.page

    @property
    def dpr(self) -> float:
        return self.page.evaluate("devicePixelRatio")

    def front(self):
        win32.set_foreground(self.hwnd)
        self.page.wait_for_timeout(250)

    def act(self, what: str, action, check, tries: int = 3, timeout: float = 5.0):
        """真实输入偶发被吞（窗口刚激活、WebView 子窗口尚未接收输入）或被真实鼠标干扰：
        动作后 check 不成立就重新拉前台再试，最多 tries 次。动作须“未生效即无副作用”；
        拖拽被干扰时 self.drag 会先把窗口复位。"""
        for i in range(tries):
            if i and check():
                return True
            try:
                action()
                return wait_until(check, timeout, what)
            except AssertionError as e:
                if i == tries - 1:
                    raise
                _RETRY_LOG.append(f"{what}: {str(e)[:160]}")
                self.front()

    def drag(self, x0, y0, x1, y1, **kw):
        win32.ensure_hit(self.hwnd, x0, y0)
        zoomed, before = win32.is_zoomed(self.hwnd), win32.rect(self.hwnd)
        try:
            win32.drag(x0, y0, x1, y1, **kw)
        except win32.InputInterference:
            if zoomed:
                win32.show(self.hwnd, 3)  # SW_MAXIMIZE
            else:
                win32.show(self.hwnd, 9)
                l, t, r, b = before
                win32.move_window(self.hwnd, l, t, r - l, b - t)
            self.page.wait_for_timeout(400)
            raise

    def click(self, x, y):
        win32.ensure_hit(self.hwnd, x, y)
        win32.click(x, y)

    def screen_of(self, box, fx: float = 0.5, fy: float = 0.5) -> tuple[int, int]:
        cx, cy = win32.client_origin(self.hwnd)
        d = self.dpr
        return cx + round((box["x"] + box["width"] * fx) * d), cy + round((box["y"] + box["height"] * fy) * d)

    def title_point(self) -> tuple[int, int]:
        """标题栏空白：取 header 中线、距左 40% 处；若命中按钮则右移。"""
        box = self.page.locator('[data-region="titlebar"]').bounding_box()
        for fx in (0.4, 0.5, 0.3, 0.6):
            x, y = box["x"] + box["width"] * fx, box["y"] + box["height"] / 2
            tag = self.page.evaluate("([x,y]) => { const e = document.elementFromPoint(x,y);"
                                     " return e && e.closest('button,input,a,[role=button],summary') ? 'ctl' : 'ok'; }", [x, y])
            if tag == "ok":
                return self.screen_of(box, fx, 0.5)
        raise AssertionError("标题栏找不到空白拖拽点")

    def button(self, name: str) -> tuple[int, int]:
        btn = self.page.locator('[data-region="titlebar"]').get_by_role("button", name=name, exact=True)
        return self.screen_of(btn.bounding_box())

    def place(self, w: int | None = None, h: int | None = None):
        """放到主窗口所在显示器工作区内的已知位置（物理像素）。

        默认尺寸 = 最小尺寸（800×600 逻辑 px × DPR）+ 足够的拖拽余量，再夹到工作区内。
        """
        win32.show(self.hwnd, 9)
        if win32.is_zoomed(self.hwnd):
            win32.show(self.hwnd, 9)
        d = self.dpr
        w = w or max(1300, round(800 * d) + 420)
        h = h or max(880, round(600 * d) + 340)
        work = win32.monitor_info(self.hwnd)["work"]
        # 四周各留 ≥140 px：向外拖边/角时不能碰到工作区边缘，否则会触发系统
        # Snap（拖上边到屏幕顶 = 纵向最大化），窗口高度被拉满而非按拖动量变化。
        w = min(w, work[2] - work[0] - 320)
        h = min(h, work[3] - work[1] - 280)
        win32.move_window(self.hwnd, work[0] + 160, work[1] + 140, w, h)
        self.page.wait_for_timeout(400)
        self.front()


@pytest.fixture
def win(real_input, app):
    w = Win(app)
    w.place()
    return w
