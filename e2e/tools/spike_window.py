"""Spike 3：无边框窗口的真实 SendInput 拖动 / 边缘命中测试。会接管鼠标约 10 秒。"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from harness.app import AppSession  # noqa: E402
from harness.paths import TMP, default_exe  # noqa: E402
from harness.sandbox import Sandbox  # noqa: E402
from win import win32  # noqa: E402

out: dict = {}
sb = Sandbox(TMP / "spike" / ("win-" + datetime.now().strftime("%Y%m%d-%H%M%S")), default_exe())
saved_cursor = win32.cursor_pos()
saved_fg = win32.foreground()
with sync_playwright() as pw:
    app = AppSession(pw, sb)
    app.start()
    hwnd = win32.main_window(app.proc.pid)
    win32.move_window(hwnd, 200, 150, 1500, 1000)
    time.sleep(0.5)
    win32.set_foreground(hwnd)
    out["dpi"] = win32.dpi_of(hwnd)
    out["rect0"] = win32.rect(hwnd)
    out["client0"] = win32.client_origin(hwnd)
    l, t, r, b = win32.rect(hwnd)
    out["hit"] = {
        "right_edge-1": win32.hit_test(hwnd, r - 1, (t + b) // 2),
        "right_edge-4": win32.hit_test(hwnd, r - 4, (t + b) // 2),
        "left_edge+1": win32.hit_test(hwnd, l + 1, (t + b) // 2),
        "bottom-1": win32.hit_test(hwnd, (l + r) // 2, b - 1),
        "top+1": win32.hit_test(hwnd, (l + r) // 2, t + 1),
        "corner_br": win32.hit_test(hwnd, r - 2, b - 2),
        "title": win32.hit_test(hwnd, l + 300, t + 15),
    }
    header = app.page.locator('[data-region="titlebar"]').bounding_box()
    out["header_css"] = header
    dpr = app.page.evaluate("devicePixelRatio")
    out["dpr"] = dpr
    win32.countdown(5)
    cx, cy = win32.client_origin(hwnd)
    sx, sy = cx + round(300 * dpr), cy + round(header["height"] / 2 * dpr)
    win32.drag(sx, sy, sx + 300, sy + 80)
    out["after_title_drag"] = win32.rect(hwnd)
    l, t, r, b = win32.rect(hwnd)
    win32.drag(r - 2, (t + b) // 2, r - 2 + 150, (t + b) // 2)
    out["after_right_edge"] = win32.rect(hwnd)
    l, t, r, b = win32.rect(hwnd)
    win32.drag(r - 2, b - 2, r - 2 - 100, b - 2 - 100)
    out["after_corner_br"] = win32.rect(hwnd)
    win32.set_cursor(*saved_cursor)
    app.stop()
win32.set_cursor(*saved_cursor)
print(json.dumps(out, ensure_ascii=False, indent=1))
