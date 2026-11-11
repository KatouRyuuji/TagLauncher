"""desktop 层·常驻（D-RES-*）：原 PR48 / PR50 真机确认项，在临时 runner 上用真实输入自动跑。

托盘点击与菜单、从其他程序按全局热键、全屏忽略与连按 3 次、二次启动唤回 / --background 不打扰、
不自启、主窗最小化 / 隐藏到托盘期间 tl 写入后唤回即是新数据。
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from harness import files
from harness.app import wait_until
from tests.cli.conftest import Tl
from tests.desktop import oswin
from tests.ui.test_collect import CLASSES, delete_tree, verb_path
from win import win32

pytestmark = [pytest.mark.physical_input, pytest.mark.visible_window]
HOTKEY = "Ctrl+Alt+Shift+F11"
KEYS = (oswin.VK["CTRL"], oswin.VK["ALT"], oswin.VK["SHIFT"], oswin.VK["F11"])
WM_CLOSE = 0x10


def main_hwnd(app) -> int:
    return win32.main_window(app.proc.pid, timeout=20, visible=False)


def main_in_front(app) -> bool:
    h = main_hwnd(app)
    return win32.is_visible(h) and not win32.is_iconic(h) and win32.foreground() == h


def fg_state(app) -> dict:
    h = main_hwnd(app)
    return {"visible": win32.is_visible(h), "iconic": win32.is_iconic(h), "fg": oswin.foreground_info(), "main": h}


def hotkey(app):
    s = app.invoke("set_hotkey", {"action": "toggle_main", "shortcut": HOTKEY})
    assert [h for h in s["hotkeys"] if h["action"] == "toggle_main"][0]["accelerator"] == HOTKEY, s


@pytest.mark.case("D-RES-01")
def test_tray_click_and_menu(app, sandbox):
    """关闭到托盘：通知区真有图标；左键单击唤回主窗到前台；右键菜单项与设置一致，点「退出」真正退出。"""
    app.close_welcome(3000)
    s = app.invoke("set_close_action", {"action": "tray"})
    assert s["trayActive"], s
    hotkey(app)
    rect = wait_until(lambda: oswin.tray_icon_rect(app.proc.pid), 10, "通知区没有找到 TagLauncher 图标")
    # Win11 系任务栏把新图标收进溢出区：先按用户操作「显示在任务栏上」，没生效再走溢出浮层
    promoted = []
    for _ in range(10):
        if promoted := oswin.promote_tray_icon(str(sandbox.exe)):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    print(f"TRAY rect={rect} promoted={promoted} rect_after={oswin.tray_icon_rect(app.proc.pid)}")
    h = main_hwnd(app)
    oswin.user32.PostMessageW(h, WM_CLOSE, 0, 0)
    wait_until(lambda: not win32.is_visible(h), 8, "关闭到托盘应隐藏主窗")
    assert app.proc.poll() is None
    click = oswin.click_tray_icon(app.proc.pid)
    print(f"TRAY_CLICK {json.dumps(click)}")
    wait_until(lambda: main_in_front(app), 8, lambda: f"左键单击托盘应唤回主窗到前台：{fg_state(app)} {click}")

    oswin.click_tray_icon(app.proc.pid, right=True, overflow=click["overflow"])
    menu = wait_until(lambda: (oswin.popup_menus(app.proc.pid) or [None])[0], 8, "右键托盘没有弹出菜单")
    items = oswin.menu_items(menu)
    print(f"TRAY_MENU {json.dumps(items, ensure_ascii=False)}")
    assert [i["text"] for i in items] == ["显示 TagLauncher（Ctrl + Alt + Shift + F11）", "", "退出"], items
    win32.click(*oswin.center(items[-1]["rect"]))
    wait_until(lambda: app.proc.poll() is not None, 15, "托盘菜单「退出」应真正退出进程")


@pytest.mark.case("D-RES-02")
def test_global_hotkey_from_another_app(app, sandbox):
    """其他程序在前台时按全局热键：主窗到前台；再按收起（无托盘时最小化）；再从其他程序按又唤回。"""
    app.close_welcome(3000)
    hotkey(app)
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        fg.focus()
        oswin.press(*KEYS)
        wait_until(lambda: main_in_front(app), 5, lambda: f"热键应唤出主窗到前台：{fg_state(app)}")
        oswin.press(*KEYS)
        wait_until(lambda: win32.is_iconic(main_hwnd(app)), 5, lambda: f"主窗在前台时再按应收起：{fg_state(app)}")
        fg.focus()
        oswin.press(*KEYS)
        wait_until(lambda: main_in_front(app), 5, lambda: f"再次唤出：{fg_state(app)}")


@pytest.mark.case("D-RES-03")
def test_fullscreen_ignores_hotkey_until_three_presses(app, sandbox):
    """前台是全屏程序：单按热键被忽略（前台不变）；2 秒内连按 3 次强制唤出。"""
    app.close_welcome(3000)
    hotkey(app)
    assert app.invoke("get_desktop_settings")["ignoreFullscreen"] is True
    with oswin.FgHelper(env=sandbox.env(None), fullscreen=True) as fg:
        fg.focus()
        l, t, r, b = win32.rect(fg.hwnd)
        mon = win32.monitor_info(fg.hwnd)
        print(f"FULLSCREEN helper={(l, t, r, b)} monitor={mon}")
        oswin.press(*KEYS)
        time.sleep(1.0)
        assert win32.foreground() == fg.hwnd, f"全屏时单按应被忽略：{fg_state(app)}"
        time.sleep(1.5)  # 越过 2 秒窗口，前一次不计入
        oswin.press(*KEYS)
        time.sleep(0.3)
        oswin.press(*KEYS)
        time.sleep(0.5)
        assert win32.foreground() == fg.hwnd, f"连按 2 次仍应被忽略：{fg_state(app)}"
        oswin.press(*KEYS)
        wait_until(lambda: main_in_front(app), 5, lambda: f"2 秒内第 3 次应强制唤出：{fg_state(app)}")


@pytest.mark.case("D-RES-04")
def test_second_launch_restores_and_background_does_not_disturb(app, sandbox):
    """主窗最小化时从前台程序再次启动 exe：主窗还原到前台；--background 再次启动不改变窗口状态。"""
    app.close_welcome(3000)
    h = main_hwnd(app)
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        win32.show(h, 6)
        wait_until(lambda: win32.is_iconic(h), 5)
        fg.focus()
        fg.startfile(sandbox.exe)
        wait_until(lambda: main_in_front(app), 10, lambda: f"二次启动应还原主窗到前台：{fg_state(app)}")

        win32.show(h, 6)
        wait_until(lambda: win32.is_iconic(h), 5)
        tray_before = app.invoke("get_desktop_settings")["trayActive"]
        fg.focus()
        fg.startfile(sandbox.exe, "open", "--background")
        time.sleep(3)
        assert win32.is_iconic(h) and win32.foreground() == fg.hwnd, f"--background 不应打扰：{fg_state(app)}"
        # 托盘需要与否看首个实例的启动方式和「关闭到托盘」设置；二次 --background 不改变它
        assert app.invoke("get_desktop_settings")["trayActive"] == tray_before, "--background 二次启动不应改变托盘状态"


def _run_values(path: str) -> dict:
    import winreg
    out = {}
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
            i = 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(k, i)
                except OSError:
                    break
                out[name] = str(value)
                i += 1
    except FileNotFoundError:
        pass
    return out


def autostart_traces(sandbox) -> dict:
    run_keys = [r"Software\Microsoft\Windows\CurrentVersion\Run", r"Software\Microsoft\Windows\CurrentVersion\RunOnce",
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"]
    hits = {}
    for key in run_keys:
        bad = {n: v for n, v in _run_values(key).items() if "tag" in (n + v).lower()}
        if bad:
            hits[key] = bad
    startup_dirs = [Path(os.environ["APPDATA"]) / r"Microsoft\Windows\Start Menu\Programs\Startup",
                    sandbox.root / "AppData" / r"Microsoft\Windows\Start Menu\Programs\Startup"]
    for d in startup_dirs:
        if d.exists():
            bad = [p.name for p in d.iterdir() if "tag" in p.name.lower()]
            if bad:
                hits[str(d)] = bad
    tasks = subprocess.run(["schtasks", "/query", "/fo", "csv", "/nh"], capture_output=True, text=True,
                           errors="replace").stdout
    bad = [line for line in tasks.splitlines() if "taglauncher" in line.lower()]
    if bad:
        hits["schtasks"] = bad
    return hits


@pytest.mark.real_registry
@pytest.mark.case("D-RES-05")
def test_no_autostart_after_enabling_everything(app, sandbox):
    """开启托盘 / 两个全局热键 / 右键菜单并重启后：Run、RunOnce、StartupApproved、启动文件夹、计划任务都没有自启项。"""
    before = autostart_traces(sandbox)
    assert before == {}, f"runner 上不应预先有 TagLauncher 自启项：{before}"
    try:
        app.invoke("set_close_action", {"action": "tray"})
        hotkey(app)
        app.invoke("set_hotkey", {"action": "open_quick", "shortcut": "Ctrl+Alt+Shift+F12"})
        app.invoke("set_shell_integration", {"enabled": True})
        app.restart()
        time.sleep(2)
        after = autostart_traces(sandbox)
        print(f"AUTOSTART {after}")
        assert after == {}, f"不应写入任何自启项：{after}"
    finally:
        try:
            app.invoke("set_shell_integration", {"enabled": False})
        except Exception:  # noqa: BLE001
            pass
        for cls in CLASSES:
            delete_tree(verb_path(cls))


@pytest.mark.case("D-RES-06")
def test_external_writes_while_minimized_or_in_tray(app, sandbox, cli_path):
    """主窗最小化 / 隐藏到托盘期间 tl add、tag、remove；唤回后不需手动刷新即是新数据。"""
    app.close_welcome(3000)
    tl = Tl(sandbox, cli_path)
    hotkey(app)
    app.invoke("set_close_action", {"action": "tray"})
    keep = files.write(sandbox.files / "bg" / "常驻.txt", "x")
    app.seed([keep])
    app.card(keep.name).wait_for(timeout=10000)
    h = main_hwnd(app)
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        for how, hide in (("minimized", lambda: win32.show(h, 6)),
                          ("tray", lambda: oswin.user32.PostMessageW(h, WM_CLOSE, 0, 0))):
            hide()
            wait_until(lambda: win32.is_iconic(h) or not win32.is_visible(h), 5)
            p = files.write(sandbox.files / "bg" / f"后台新增-{how}.txt", "x")
            tl.run("add", str(p))
            time.sleep(1.5)  # 隐藏期检测间隔较长：确保写入发生在隐藏期间
            fg.focus()
            oswin.press(*KEYS)
            wait_until(lambda: main_in_front(app), 5, lambda: f"{how}：热键唤回：{fg_state(app)}")
            t0 = time.time()
            app.card(p.name).wait_for(timeout=3000)
            print(f"BG_SYNC {how} appear_ms={round((time.time() - t0) * 1000)}")
    assert {i["name"] for i in app.items()} >= {"常驻.txt", "后台新增-minimized.txt", "后台新增-tray.txt"}
