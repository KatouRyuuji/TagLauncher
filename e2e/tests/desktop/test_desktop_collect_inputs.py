"""desktop 层·收纳入口（D-COLLECT-*）：热键 B 读真实资源管理器的选中项、无选中项时收剪贴板、
快速窗里的剪贴板提示、从资源管理器真实拖入快速窗。会动剪贴板、开资源管理器窗口、接管输入，只在临时 runner 跑。
"""
from __future__ import annotations

import json
import os
import time

import pytest

from harness import files
from harness.app import wait_until
from tests.desktop import oswin
from tests.desktop.test_desktop_shell import QUICK_TITLE, foreground_report
from tests.ui.test_collect import collect_page, result, same_path, wait_attr, wait_session_done
from tests.ui.test_quick import quick_pages
from win import win32

pytestmark = [pytest.mark.physical_input, pytest.mark.visible_window]
COLLECT_KEY = "Ctrl+Alt+Shift+F8"
COLLECT_VKS = (oswin.VK["CTRL"], oswin.VK["ALT"], oswin.VK["SHIFT"], 0x77)
QUICK_KEY = "Ctrl+Alt+Shift+F7"
QUICK_VKS = (oswin.VK["CTRL"], oswin.VK["ALT"], oswin.VK["SHIFT"], 0x76)


def bind(app, action: str, key: str) -> None:
    s = app.invoke("set_hotkey", {"action": action, "shortcut": key})
    assert [h for h in s["hotkeys"] if h["action"] == action][0]["accelerator"] == key, s


def session_names(app) -> list[str]:
    s = app.invoke("collect_session")
    return sorted(os.path.basename(p) for p in (s or {}).get("paths", []))


@pytest.mark.case("D-COLLECT-01")
def test_hotkey_collects_explorer_selection(app, sandbox):
    """资源管理器里选中 2 项 → 按收纳热键：会话正好是这 2 项（没选中的不进来），快速窗在前台。"""
    app.close_welcome(3000)
    bind(app, "collect_selection", COLLECT_KEY)
    d = sandbox.files / "explorer-sel"
    for n in ("one.txt", "two.txt", "skip.txt"):
        files.write(d / n, n)
    (d / "sub").mkdir()
    oswin.clear_clipboard()
    with oswin.ExplorerWindow(d) as ex:
        ex.select(["one.txt", "sub"])
        assert win32.set_foreground(ex.hwnd, timeout=5), oswin.foreground_info()
        time.sleep(0.3)
        t0 = time.time()
        oswin.press(*COLLECT_VKS)
        qp = collect_page(app)
        wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "2")
        print(f"HOTKEY_B explorer ms={round((time.time() - t0) * 1000)} fg={json.dumps(foreground_report(app), ensure_ascii=False)}")
        assert session_names(app) == ["one.txt", "sub"]
        assert len(quick_pages(app)) == 1
        qp.get_by_test_id("collect-action-import").click()
        r = result(qp)
        assert r["failed"] == "0" and int(r["created"]) >= 2, r
        wait_session_done(app)


@pytest.mark.case("D-COLLECT-02")
def test_hotkey_falls_back_to_clipboard_files(app, sandbox):
    """前台不是资源管理器：按收纳热键改收剪贴板里复制的文件；剪贴板也没有时不弹窗。"""
    app.close_welcome(3000)
    bind(app, "collect_selection", COLLECT_KEY)
    a = files.write(sandbox.files / "clipfb" / "a.txt", "a")
    b = files.write(sandbox.files / "clipfb" / "b.txt", "b")
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        oswin.clear_clipboard()
        fg.focus()
        oswin.press(*COLLECT_VKS)
        time.sleep(1.5)
        assert app.invoke("collect_session") is None and not oswin.window_by_title(app.proc.pid, QUICK_TITLE), \
            "没有选中项也没有剪贴板文件时不应弹收纳窗"
        oswin.set_clipboard_files([str(a), str(b)])
        fg.focus()
        oswin.press(*COLLECT_VKS)
        qp = collect_page(app)
        wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "2")
        assert session_names(app) == ["a.txt", "b.txt"]
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == "2"
        wait_session_done(app)
    oswin.clear_clipboard()


@pytest.mark.case("D-COLLECT-03")
def test_quick_window_offers_clipboard_collect(app, sandbox):
    """复制了文件后唤出快速搜索窗：提示「收纳剪贴板中的 N 项」，点击进入收纳；剪贴板是一行一个路径的文本也认。"""
    app.close_welcome(3000)
    bind(app, "open_quick", QUICK_KEY)
    a = files.write(sandbox.files / "clipq" / "a.txt", "a")
    b = files.write(sandbox.files / "clipq" / "b.txt", "b")
    oswin.set_clipboard_files([str(a), str(b)])
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        fg.focus()
        oswin.press(*QUICK_VKS)
        qp = wait_until(lambda: next(iter(quick_pages(app)), None), 15, "快速窗没出现")
        banner = qp.get_by_test_id("quick-clipboard")
        banner.wait_for(timeout=10000)
        assert banner.get_attribute("data-count") == "2", banner.inner_text()
        banner.click()
        cp = collect_page(app)
        wait_attr(cp.get_by_test_id("collect-summary"), "data-count", "2")
        cp.get_by_test_id("collect-action-import").click()
        assert result(cp)["created"] == "2"
        wait_until(lambda: app.invoke("collect_session") is None, 15)

        oswin.set_clipboard_text(f'"{a}"\r\n不是路径\r\n')
        fg.focus()
        oswin.press(*QUICK_VKS)
        qp = wait_until(lambda: next((p for p in quick_pages(app) if p.get_by_test_id("quick-input").count()), None), 15)
        wait_until(lambda: qp.get_by_test_id("quick-clipboard").get_attribute("data-count") == "1", 10,
                   lambda: qp.get_by_test_id("quick-clipboard").count())
    oswin.clear_clipboard()


@pytest.mark.case("D-COLLECT-04")
def test_drag_from_explorer_into_quick_window(app, sandbox):
    """从资源管理器拖文件，拖动中按快速搜索热键唤出快速窗，松开在快速窗上 → 收纳会话就是被拖的文件。"""
    app.close_welcome(3000)
    bind(app, "open_quick", QUICK_KEY)
    d = sandbox.files / "dragq"
    f = files.write(d / "dragme.txt", "x")
    oswin.clear_clipboard()
    with oswin.ExplorerWindow(d) as ex:
        assert win32.set_foreground(ex.hwnd, timeout=5)
        time.sleep(0.5)
        x0, y0 = oswin.center(ex.item_rect(f.name))
        win32.mouse_move(x0, y0)
        time.sleep(0.2)
        win32.mouse_down()
        time.sleep(0.2)
        for i in range(1, 15):  # 越过拖动阈值，开始 OLE 拖放
            win32.mouse_move(x0 + i * 4, y0 + i * 3)
            time.sleep(0.02)
        oswin.press(*QUICK_VKS)
        try:
            h = wait_until(lambda: oswin.window_by_title(app.proc.pid, QUICK_TITLE), 10, "拖动中按热键快速窗没出现")
            x1, y1 = oswin.center(win32.rect(h))
            cx, cy = x0 + 56, y0 + 42
            for i in range(1, 31):
                win32.mouse_move(round(cx + (x1 - cx) * i / 30), round(cy + (y1 - cy) * i / 30))
                time.sleep(0.03)
            time.sleep(0.4)
            qp = next(iter(quick_pages(app)), None)
            overlay = qp.get_by_test_id("quick-drop-overlay").count() if qp else None
        finally:
            win32.mouse_up()
        print(f"DRAG overlay_seen={overlay} rect={win32.rect(h)}")
        cp = collect_page(app)
        wait_attr(cp.get_by_test_id("collect-summary"), "data-count", "1")
        s = app.invoke("collect_session")
        assert same_path(s["paths"][0], f), s
        cp.get_by_test_id("collect-action-import").click()
        assert result(cp)["created"] == "1"
