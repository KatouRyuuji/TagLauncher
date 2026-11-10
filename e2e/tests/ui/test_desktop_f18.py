"""F18 桌面驻留（E-DSK-01..05）：「动作→快捷键」表真实注册 / 冲突回滚 / 关闭到托盘 / 后台启动。

快捷键是否真被系统注册，用测试进程自己调用 Win32 RegisterHotKey 只读探测：
应用持有时探测注册必然失败，释放后必然成功。不发送任何物理按键。
"""
from __future__ import annotations

import ctypes
import time

import pytest

from harness import db as dbh
from harness.app import wait_until
from win import win32

MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x1, 0x2, 0x4, 0x4000
VK_F9, VK_F10 = 0x78, 0x79
COMBO = MOD_CONTROL | MOD_ALT | MOD_SHIFT
user32 = ctypes.WinDLL("user32", use_last_error=True)


def os_hotkey_free(vk: int) -> bool:
    """本进程能注册即说明没人占用（随即释放）。"""
    ok = bool(user32.RegisterHotKey(None, 0xB00, COMBO | MOD_NOREPEAT, vk))
    if ok:
        user32.UnregisterHotKey(None, 0xB00)
    return ok


def desktop(app) -> dict:
    return app.invoke("get_desktop_settings")


def toggle_main(app) -> dict:
    s = desktop(app)
    [h] = [h for h in s["hotkeys"] if h["action"] == "toggle_main"]
    return h


def set_toggle(app, shortcut):
    return app.invoke("set_hotkey", {"action": "toggle_main", "shortcut": shortcut})


def set_toggle_error(app, shortcut):
    return app.invoke_error("set_hotkey", {"action": "toggle_main", "shortcut": shortcut})


@pytest.mark.case("E-DSK-01")
def test_defaults_grab_nothing(app, sandbox):
    s = desktop(app)
    assert [h["action"] for h in s["hotkeys"]] == ["toggle_main"], s
    assert toggle_main(app)["accelerator"] is None and toggle_main(app)["error"] is None, s
    assert s["closeAction"] == "exit" and s["ignoreFullscreen"] is True and s["launchMode"] == "show", s
    assert s["trayActive"] is False, "默认不建托盘"
    assert dbh.meta(sandbox.db_path, "hotkey.toggle_main") in (None, "")
    # 通用 set_setting 不能绕过专用通道
    for key in ("hotkey.toggle_main", "desktop.close_action", "hotkey.ignore_fullscreen"):
        assert app.invoke_error("set_setting", {"key": key, "value": "x"}), key
    assert "未知的快捷键动作" in (app.invoke_error("set_hotkey", {"action": "quick_search", "shortcut": "Ctrl+Alt+KeyQ"}) or "")
    dlg = app.open_settings("桌面驻留")
    assert dlg.get_by_test_id("hotkey-value-toggle_main").inner_text() == "未启用"
    assert dlg.get_by_role("radio", name="退出程序").get_attribute("aria-checked") == "true"
    assert dlg.get_by_role("switch", name="全屏时忽略全局快捷键").get_attribute("aria-checked") == "true"
    dlg.get_by_role("switch", name="全屏时忽略全局快捷键").click()
    wait_until(lambda: desktop(app)["ignoreFullscreen"] is False, 5)
    assert dbh.meta(sandbox.db_path, "hotkey.ignore_fullscreen") == "0"


@pytest.mark.case("E-DSK-02")
def test_shortcut_really_registers_and_survives_restart(app, sandbox):
    assert os_hotkey_free(VK_F9), "前置：Ctrl+Alt+Shift+F9 未被占用"
    set_toggle(app, "Ctrl+Alt+Shift+F9")
    assert toggle_main(app)["accelerator"] == "Ctrl+Alt+Shift+F9"
    wait_until(lambda: not os_hotkey_free(VK_F9), 5, "应用未真正向系统注册快捷键")
    assert dbh.meta(sandbox.db_path, "hotkey.toggle_main") == "Ctrl+Alt+Shift+F9"
    # 单键 / 只加 Shift 被拒，原值不变
    assert "至少要包含" in (set_toggle_error(app, "Shift+F9") or "")
    assert toggle_main(app)["accelerator"] == "Ctrl+Alt+Shift+F9"
    app.restart()
    wait_until(lambda: toggle_main(app)["accelerator"] == "Ctrl+Alt+Shift+F9", 10, lambda: desktop(app))
    assert not os_hotkey_free(VK_F9), "重启后应按设置重新注册"
    dlg = app.open_settings("桌面驻留")
    assert dlg.get_by_test_id("hotkey-value-toggle_main").inner_text() == "Ctrl + Alt + Shift + F9"
    # 选「退出程序」时提示全局功能会随程序退出失效
    assert "失效" in dlg.get_by_test_id("close-exit-warning").inner_text()
    dlg.get_by_role("button", name="清除：显示 / 隐藏主窗口", exact=True).click()
    wait_until(lambda: toggle_main(app)["accelerator"] is None, 5)
    wait_until(lambda: os_hotkey_free(VK_F9), 5, "清除后应释放系统快捷键")
    assert app.js_errors() == []


@pytest.mark.case("E-DSK-03")
def test_conflict_rolls_back_to_previous(app, sandbox):
    set_toggle(app, "Ctrl+Alt+Shift+F9")
    assert user32.RegisterHotKey(None, 0xB01, COMBO | MOD_NOREPEAT, VK_F10), "测试进程先占住 F10"
    try:
        err = set_toggle_error(app, "Ctrl+Alt+Shift+F10")
        assert err and "占用" in err and "Ctrl+Alt+Shift+F9" in err, err
        assert toggle_main(app)["accelerator"] == "Ctrl+Alt+Shift+F9"
        assert dbh.meta(sandbox.db_path, "hotkey.toggle_main") == "Ctrl+Alt+Shift+F9"
        assert not os_hotkey_free(VK_F9), "回滚后旧快捷键仍由应用持有"
    finally:
        user32.UnregisterHotKey(None, 0xB01)
    set_toggle(app, None)


@pytest.mark.case("E-DSK-04")
def test_close_to_tray_hides_instead_of_exit(app, sandbox):
    app.close_welcome(3000)
    hwnd = win32.main_window(app.proc.pid)
    s = app.invoke("set_close_action", {"action": "tray"})
    assert s["closeAction"] == "tray" and s["trayActive"] is True, s
    assert dbh.meta(sandbox.db_path, "desktop.close_action") == "tray"
    app.page.get_by_role("button", name="关闭", exact=True).click()
    wait_until(lambda: not win32.is_visible(hwnd), 8, "托盘模式下关闭应隐藏窗口")
    time.sleep(1.5)
    assert app.proc.poll() is None, "托盘模式下关闭不应退出进程"
    # 切回「退出」：托盘移除，关闭即退出（默认旧行为）
    s = app.invoke("set_close_action", {"action": "exit"})
    assert s["closeAction"] == "exit" and s["trayActive"] is False, s
    app.page.evaluate("window.__TAURI__.window.getCurrentWindow().close()")
    wait_until(lambda: app.proc.poll() is not None, 15, "退出模式下关闭应退出进程")


@pytest.mark.case("E-DSK-05")
def test_background_launch_keeps_main_window_hidden(app_factory, sandbox):
    """--background：主题就绪、首批对象渲染后主窗仍不显示，只驻托盘。"""
    # 隐藏窗口里 rAF 可能停摆：不点欢迎页（Playwright 点击要等元素稳定，依赖出帧）
    app = app_factory(args=["--background"], dismiss_welcome=False)
    s = desktop(app)
    assert s["launchMode"] == "background" and s["trayActive"] is True, s
    # 根节点已由 harness 等到；主题就绪后的 show 若会发生，3 秒内必然发生
    time.sleep(3)
    hwnd = win32.main_window(app.proc.pid, timeout=10, visible=False)
    assert not win32.is_visible(hwnd), "后台启动不应显示主窗"
    assert app.proc.poll() is None
