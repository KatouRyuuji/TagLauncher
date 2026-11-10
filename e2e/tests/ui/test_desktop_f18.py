"""F18 桌面驻留（E-DSK-01..04）：全局快捷键真实注册 / 冲突回滚 / 关闭到托盘。

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


@pytest.mark.case("E-DSK-01")
def test_defaults_grab_nothing(app, sandbox):
    s = desktop(app)
    assert s["globalShortcut"] is None and s["closeAction"] == "exit" and s["shortcutError"] is None, s
    assert dbh.meta(sandbox.db_path, "desktop.global_shortcut") in (None, "")
    # 通用 set_setting 不能绕过专用通道
    assert app.invoke_error("set_setting", {"key": "desktop.global_shortcut", "value": "Ctrl+Alt+KeyK"})
    dlg = app.open_settings("桌面驻留")
    assert dlg.get_by_test_id("global-shortcut-value").inner_text() == "未启用"
    assert dlg.get_by_role("radio", name="退出程序").get_attribute("aria-checked") == "true"


@pytest.mark.case("E-DSK-02")
def test_shortcut_really_registers_and_survives_restart(app, sandbox):
    assert os_hotkey_free(VK_F9), "前置：Ctrl+Alt+Shift+F9 未被占用"
    s = app.invoke("set_global_shortcut", {"shortcut": "Ctrl+Alt+Shift+F9"})
    assert s["globalShortcut"] == "Ctrl+Alt+Shift+F9", s
    wait_until(lambda: not os_hotkey_free(VK_F9), 5, "应用未真正向系统注册快捷键")
    assert dbh.meta(sandbox.db_path, "desktop.global_shortcut") == "Ctrl+Alt+Shift+F9"
    # 单键 / 只加 Shift 被拒，原值不变
    assert "至少要包含" in (app.invoke_error("set_global_shortcut", {"shortcut": "Shift+F9"}) or "")
    assert desktop(app)["globalShortcut"] == "Ctrl+Alt+Shift+F9"
    app.restart()
    wait_until(lambda: desktop(app)["globalShortcut"] == "Ctrl+Alt+Shift+F9", 10, lambda: desktop(app))
    assert not os_hotkey_free(VK_F9), "重启后应按设置重新注册"
    dlg = app.open_settings("桌面驻留")
    assert dlg.get_by_test_id("global-shortcut-value").inner_text() == "Ctrl + Alt + Shift + F9"
    dlg.get_by_role("button", name="清除", exact=True).click()
    wait_until(lambda: desktop(app)["globalShortcut"] is None, 5)
    wait_until(lambda: os_hotkey_free(VK_F9), 5, "清除后应释放系统快捷键")
    assert app.js_errors() == []


@pytest.mark.case("E-DSK-03")
def test_conflict_rolls_back_to_previous(app, sandbox):
    app.invoke("set_global_shortcut", {"shortcut": "Ctrl+Alt+Shift+F9"})
    assert user32.RegisterHotKey(None, 0xB01, COMBO | MOD_NOREPEAT, VK_F10), "测试进程先占住 F10"
    try:
        err = app.invoke_error("set_global_shortcut", {"shortcut": "Ctrl+Alt+Shift+F10"})
        assert err and "占用" in err and "Ctrl+Alt+Shift+F9" in err, err
        s = desktop(app)
        assert s["globalShortcut"] == "Ctrl+Alt+Shift+F9", s
        assert dbh.meta(sandbox.db_path, "desktop.global_shortcut") == "Ctrl+Alt+Shift+F9"
        assert not os_hotkey_free(VK_F9), "回滚后旧快捷键仍由应用持有"
    finally:
        user32.UnregisterHotKey(None, 0xB01)
    app.invoke("set_global_shortcut", {"shortcut": None})


@pytest.mark.case("E-DSK-04")
def test_close_to_tray_hides_instead_of_exit(app, sandbox):
    app.close_welcome(3000)
    hwnd = win32.main_window(app.proc.pid)
    s = app.invoke("set_close_action", {"action": "tray"})
    assert s["closeAction"] == "tray"
    assert dbh.meta(sandbox.db_path, "desktop.close_action") == "tray"
    app.page.get_by_role("button", name="关闭", exact=True).click()
    wait_until(lambda: not win32.is_visible(hwnd), 8, "托盘模式下关闭应隐藏窗口")
    time.sleep(1.5)
    assert app.proc.poll() is None, "托盘模式下关闭不应退出进程"
    # 切回「退出」：托盘移除，关闭即退出（默认旧行为）
    assert app.invoke("set_close_action", {"action": "exit"})["closeAction"] == "exit"
    app.page.evaluate("window.__TAURI__.window.getCurrentWindow().close()")
    wait_until(lambda: app.proc.poll() is not None, 15, "退出模式下关闭应退出进程")
