"""desktop 层·钉住视图 / 边缘抽屉（D-PIN-*）：真实鼠标碰边滑出、离开收回、划过不弹、
前台全屏时把手隐藏且不弹出、拖动换边与重启后位置记忆、浮动窗拖动记忆、托盘菜单开关。"""
from __future__ import annotations

import json
import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until
from tests.desktop import oswin
from win import win32

pytestmark = [pytest.mark.physical_input, pytest.mark.visible_window]
QUICK_TITLE = "TagLauncher 快速搜索"


def quick_hwnd(app, visible_only: bool = False) -> int:
    return wait_until(lambda: oswin.window_by_title(app.proc.pid, QUICK_TITLE, visible_only=visible_only), 20,
                      "没有找到 quick 窗口")


def pin_settings(app, **patch) -> dict:
    cur = app.invoke("get_pin_settings")
    cur.update(patch)
    return app.invoke("set_pin_settings", {"settings": cur})


def drawer(app) -> str:
    return app.invoke("pin_diag")["view"]["drawer"]


def width(h: int) -> int:
    l, _, r, _ = win32.rect(h)
    return r - l


def scale(h: int) -> float:
    return win32.dpi_of(h) / 96


def setup_drawer(app, sandbox, edge: str = "right") -> int:
    app.close_welcome(3000)
    paths = [files.write(sandbox.files / "dpin" / n, n) for n in ("甲.txt", "乙.txt")]
    app.seed(paths)
    cab = app.invoke("add_cabinet", {"name": "桌面柜", "color": "#22c55e"})["id"]
    app.invoke("add_items_to_cabinet", {"cabinetId": cab, "itemIds": [app.item("甲.txt")["id"], app.item("乙.txt")["id"]]})
    pin_settings(app, enabled=True, source={"kind": "cabinet", "id": cab}, mode="drawer", edge=edge)
    h = quick_hwnd(app)
    wait_until(lambda: win32.is_visible(h) and width(h) <= round(6 * scale(h)), 8,
               lambda: f"抽屉应收起为贴边把手：visible={win32.is_visible(h)} rect={win32.rect(h)}")
    return h


def park_mouse(h: int) -> None:
    """把鼠标放到把手所在显示器的中央（远离边缘）"""
    l, t, r, b = win32.monitor_info(h)["work"]
    win32.mouse_move((l + r) // 2, (t + b) // 2)
    time.sleep(0.3)


def hit_edge(h: int) -> tuple[int, int]:
    l, t, r, b = win32.rect(h)
    x, y = (r - 1 if r > win32.monitor_info(h)["work"][2] - 10 else l), (t + b) // 2
    win32.mouse_move(x, y)
    return x, y


@pytest.mark.case("D-PIN-01")
def test_drawer_slides_out_on_edge_hover_and_collapses_on_leave(app, sandbox):
    """把手贴在工作区右边缘；鼠标碰边停留 → 滑出到面板宽；划过（不停留）不弹；离开面板 → 收回。"""
    h = setup_drawer(app, sandbox)
    work = win32.monitor_info(h)["work"]
    l, t, r, b = win32.rect(h)
    assert r == work[2], f"把手应贴工作区右边：rect={(l, t, r, b)} work={work}"
    park_mouse(h)

    # 划过：碰到边立刻离开
    hit_edge(h)
    time.sleep(0.04)
    park_mouse(h)
    time.sleep(0.6)
    assert drawer(app) == "collapsed" and width(h) <= round(6 * scale(h)), "划过边缘不应弹出"

    t0 = time.time()
    hit_edge(h)
    panel = round(320 * scale(h))
    wait_until(lambda: width(h) == panel, 3, lambda: f"碰边停留应滑出：rect={win32.rect(h)} drawer={drawer(app)}")
    expand_ms = round((time.time() - t0) * 1000)
    assert win32.rect(h)[2] == work[2], "滑出后仍贴右边"
    assert oswin.is_topmost(h), "抽屉应置顶"
    # 鼠标在面板里移动不收回
    l, t, r, b = win32.rect(h)
    win32.mouse_move((l + r) // 2, (t + b) // 2)
    time.sleep(1.0)
    assert drawer(app) == "expanded"
    t0 = time.time()
    park_mouse(h)
    wait_until(lambda: width(h) <= round(6 * scale(h)), 3, lambda: f"离开面板应收回：rect={win32.rect(h)}")
    collapse_ms = round((time.time() - t0) * 1000)
    print(f"PIN_DRAWER expand_ms={expand_ms} collapse_ms={collapse_ms} rect={win32.rect(h)} work={work}")


@pytest.mark.case("D-PIN-02")
def test_drawer_hides_and_never_pops_over_fullscreen(app, sandbox):
    """前台切到全屏程序：把手隐藏、碰边不弹出（展开请求也被拒）；切回普通窗口后把手恢复、可再滑出。"""
    h = setup_drawer(app, sandbox)
    assert app.invoke("pin_diag")["hookInstalled"] is True
    with oswin.FgHelper(env=sandbox.env(None)) as normal, oswin.FgHelper(env=sandbox.env(None), fullscreen=True) as fs:
        normal.focus()
        time.sleep(0.5)
        assert win32.is_visible(h), "普通前台时把手可见"
        fs.focus()
        print(f"FULLSCREEN rect={win32.rect(fs.hwnd)} monitor={win32.monitor_info(fs.hwnd)}")
        wait_until(lambda: not win32.is_visible(h), 3, lambda: f"前台全屏时把手应隐藏：drawer={drawer(app)}")
        assert drawer(app) == "hiddenFullscreen"
        hit_edge(h)
        time.sleep(0.8)
        assert not win32.is_visible(h) and drawer(app) == "hiddenFullscreen", "全屏时碰边不应弹出"
        assert app.invoke("pin_expand") is False
        normal.focus()
        wait_until(lambda: win32.is_visible(h) and drawer(app) == "collapsed", 3,
                   lambda: f"离开全屏后把手应恢复：visible={win32.is_visible(h)} drawer={drawer(app)}")
        park_mouse(h)
        hit_edge(h)
        wait_until(lambda: drawer(app) == "expanded", 3, "恢复后应能再次滑出")
        park_mouse(h)
        wait_until(lambda: drawer(app) == "collapsed", 3)


@pytest.mark.case("D-PIN-03")
def test_drawer_drag_switches_edge_and_position_survives_restart(app, sandbox):
    """拖动展开的抽屉到屏幕左侧偏上：松手吸附到左边并记住显示器 / 边 / 上下比例；重启后把手仍在原处。"""
    h = setup_drawer(app, sandbox)
    work = win32.monitor_info(h)["work"]
    park_mouse(h)
    hit_edge(h)
    wait_until(lambda: drawer(app) == "expanded" and width(h) == round(320 * scale(h)), 3)
    l, t, r, b = win32.rect(h)
    hx, hy = (l + r) // 2, t + round(16 * scale(h))  # 标题栏（拖动区）
    tx, ty = work[0] + 200, work[1] + 60 + (hy - t)
    win32.drag(hx, hy, tx, ty, steps=30)
    wait_until(lambda: app.invoke("get_pin_settings")["edge"] == "left", 5,
               lambda: f"松手应吸附到左边：rect={win32.rect(h)} settings={app.invoke('get_pin_settings')}")
    wait_until(lambda: win32.rect(h)[0] == work[0], 3, lambda: f"应贴左边：rect={win32.rect(h)} work={work}")
    offset = float(dbh.meta(sandbox.db_path, "pin.drawer_offset"))
    assert offset < 0.3, f"上下比例应偏上：{offset}"
    assert dbh.meta(sandbox.db_path, "pin.edge") == "left"
    top_before = win32.rect(h)[1]
    park_mouse(h)
    wait_until(lambda: drawer(app) == "collapsed", 3)

    app.restart()
    h = quick_hwnd(app)
    wait_until(lambda: win32.is_visible(h) and win32.rect(h)[0] == work[0] and width(h) <= round(6 * scale(h)), 10,
               lambda: f"重启后把手应在左边：rect={win32.rect(h)}")
    assert abs(win32.rect(h)[1] - top_before) <= 2, f"上下位置应记住：{win32.rect(h)[1]} vs {top_before}"
    print(f"PIN_REMEMBER offset={offset} rect={win32.rect(h)} monitor={dbh.meta(sandbox.db_path, 'pin.drawer_monitor')}")


@pytest.mark.case("D-PIN-04")
def test_float_drag_remembered_and_tray_toggle(app, sandbox):
    """浮动窗：拖动标题移动，重启后在原位置；关闭到托盘后托盘菜单有「隐藏钉住视图」，点击即隐藏、再点显示。"""
    app.close_welcome(3000)
    f = files.write(sandbox.files / "fpin" / "丙.txt", "x")
    app.seed([f])
    cab = app.invoke("add_cabinet", {"name": "浮动柜", "color": "#22c55e"})["id"]
    app.invoke("add_items_to_cabinet", {"cabinetId": cab, "itemIds": [app.item("丙.txt")["id"]]})
    pin_settings(app, enabled=True, source={"kind": "cabinet", "id": cab}, mode="float")
    h = quick_hwnd(app)
    wait_until(lambda: win32.is_visible(h), 8)
    assert oswin.is_topmost(h), "浮动窗默认置顶"
    l, t, r, b = win32.rect(h)
    hx, hy = (l + r) // 2, t + round(16 * scale(h))
    win32.drag(hx, hy, hx - 300, hy + 80, steps=30)
    wait_until(lambda: dbh.meta(sandbox.db_path, "pin.float_rect"), 5, "拖动后应保存位置")
    moved = win32.rect(h)
    assert abs(moved[0] - (l - 300)) <= 3 and abs(moved[1] - (t + 80)) <= 3, (moved, (l, t))
    app.restart()
    h = quick_hwnd(app)
    wait_until(lambda: win32.is_visible(h) and abs(win32.rect(h)[0] - moved[0]) <= 2 and abs(win32.rect(h)[1] - moved[1]) <= 2,
               10, lambda: f"重启后应在原位置：{win32.rect(h)} vs {moved}")

    # 托盘
    app.close_welcome(3000)
    assert app.invoke("set_close_action", {"action": "tray"})["trayActive"]
    wait_until(lambda: oswin.tray_icon_rect(app.proc.pid), 10, "通知区没有找到 TagLauncher 图标")
    for _ in range(10):
        if oswin.promote_tray_icon(str(sandbox.exe)):
            break
        time.sleep(0.5)
    time.sleep(1.5)

    def tray_menu() -> list[dict]:
        click = oswin.click_tray_icon(app.proc.pid, right=True)
        menu = wait_until(lambda: (oswin.popup_menus(app.proc.pid) or [None])[0], 8, f"右键托盘没有弹出菜单：{click}")
        return oswin.menu_items(menu)

    items = tray_menu()
    print(f"PIN_TRAY {json.dumps(items, ensure_ascii=False)}")
    [hide_item] = [i for i in items if i["text"] == "隐藏钉住视图"]
    win32.click(*oswin.center(hide_item["rect"]))
    wait_until(lambda: not win32.is_visible(h), 5, "托盘「隐藏钉住视图」后应隐藏")
    assert app.invoke("get_pin_settings")["enabled"] is False
    items = tray_menu()
    [show_item] = [i for i in items if i["text"] == "显示钉住视图"]
    win32.click(*oswin.center(show_item["rect"]))
    h = quick_hwnd(app)
    wait_until(lambda: win32.is_visible(h), 8, "托盘「显示钉住视图」后应显示")
