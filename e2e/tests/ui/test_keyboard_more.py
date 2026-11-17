"""键盘 P1/P2（E-KB-03/07/08/10/13/14/15）。全部经 CDP 派发，不接管系统鼠标键盘。"""
from __future__ import annotations

import time

import pytest

from harness import files
from harness.app import wait_until


def blur(app):
    app.page.evaluate("() => document.activeElement && document.activeElement.blur()")


def list_view(app):
    app.page.get_by_role("button", name="列表视图", exact=True).click()


def seed_n(app, sandbox, n, prefix="键"):
    paths = [files.write(sandbox.files / "kbm" / f"{prefix}{i:02d}.txt", str(i)) for i in range(n)]
    app.seed(paths)
    return paths


@pytest.mark.case("E-KB-03")
def test_shift_arrow_range(app, sandbox):
    seed_n(app, sandbox, 8)
    list_view(app)
    names = app.visible_names()
    ids = {i["name"]: i["id"] for i in app.items()}
    app.select_card(names[0])
    for _ in range(3):
        app.page.keyboard.press("Shift+ArrowDown")
    want = sorted(ids[n] for n in names[:4])
    wait_until(lambda: sorted(app.selected_ids()) == want, 3, app.selected_ids)
    app.page.keyboard.press("Shift+ArrowUp")
    wait_until(lambda: sorted(app.selected_ids()) == want[:0] + sorted(ids[n] for n in names[:3]), 3, app.selected_ids)


@pytest.mark.case("E-KB-07")
# BUG-10 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
@pytest.mark.parametrize("key", ["Shift+F10", "ContextMenu"])
def test_keyboard_context_menu(app, sandbox, key):
    seed_n(app, sandbox, 3)
    list_view(app)
    names = app.visible_names()
    app.select_card(names[1])
    app.page.keyboard.press(key)
    menu = app.page.get_by_role("menu").first
    menu.wait_for(timeout=3000)
    time.sleep(0.3)
    assert app.page.get_by_role("menu").count() == 1, "叠开了多个菜单"
    assert "打开" in menu.inner_text() or "收藏" in menu.inner_text(), menu.inner_text()
    # 菜单在焦点项附近：竖直方向与该行重叠或紧邻
    row = app.card(names[1]).bounding_box()
    box = menu.bounding_box()
    assert abs(box["y"] - (row["y"] + row["height"] / 2)) < 400, (row, box)
    focused = lambda: app.page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role')")
    wait_until(lambda: focused() == "menuitem", 3, focused)
    first = app.page.evaluate("() => document.activeElement.textContent")
    app.page.keyboard.press("ArrowDown")
    wait_until(lambda: app.page.evaluate("() => document.activeElement.textContent") != first, 3)
    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached", timeout=3000)


@pytest.mark.case("E-KB-08")
def test_view_hotkeys(app, sandbox):
    seed_n(app, sandbox, 2)
    blur(app)
    grp = app.page.get_by_role("group", name="显示方式")
    for key, label in (("Control+l", "列表视图"), ("Control+i", "大图标视图"), ("Control+g", "网格视图")):
        app.page.keyboard.press(key)
        wait_until(lambda: grp.get_by_role("button", name=label, exact=True).get_attribute("aria-pressed") == "true",
                   3, f"{key} 未切到 {label}")


@pytest.mark.case("E-KB-10")
def test_typeahead(app, sandbox):
    app.seed([files.write(sandbox.files / "kbt" / n, n) for n in ("apple.txt", "banana.txt", "cherry.txt", "berry.txt")])
    list_view(app)
    app.select_card("apple.txt")
    ids = {i["name"]: i["id"] for i in app.items()}
    app.page.keyboard.type("ch", delay=40)
    wait_until(lambda: app.selected_ids() == [ids["cherry.txt"]], 3, app.selected_ids)
    time.sleep(0.8)                 # 600ms 缓冲过后重新起头
    app.page.keyboard.type("be", delay=40)
    wait_until(lambda: app.selected_ids() == [ids["berry.txt"]], 3, app.selected_ids)
    time.sleep(0.8)
    app.page.keyboard.type("zq", delay=40)
    app.page.get_by_text("没有名称匹配「zq」").wait_for(timeout=3000)
    assert app.selected_ids() == [ids["berry.txt"]]


@pytest.mark.case("E-KB-13")
def test_palette_item_launch(app, sandbox):
    bat = files.marker_exe(sandbox.files / "kbp" / "面板启动.exe")   # windows 子系统，不弹控制台
    app.seed([bat, files.write(sandbox.files / "kbp" / "无关.txt", "x")])
    blur(app)
    app.page.keyboard.press("Control+k")
    pal = app.page.get_by_role("dialog", name="命令面板")
    pal.wait_for(timeout=3000)
    box = pal.get_by_label("搜索命令或项目")
    box.press_sequentially("面板启动", delay=30)
    pal.get_by_text("面板启动.exe").first.wait_for(timeout=5000)
    # 命令先于项目：移到项目行再回车
    while True:
        active = pal.locator("[data-active-row]").inner_text()
        if "面板启动.exe" in active:
            break
        box.press("ArrowDown")
    box.press("Enter")
    pal.wait_for(state="detached", timeout=3000)
    files.wait_marker(bat)


@pytest.mark.case("E-KB-14")
def test_shortcuts_help_search(app):
    blur(app)
    app.page.keyboard.press("?")
    dlg = app.page.locator('[aria-labelledby="shortcuts-help-title"]')
    dlg.wait_for(timeout=3000)
    total = dlg.locator("li").count()
    dlg.get_by_label("搜索快捷键").fill("收藏")
    wait_until(lambda: 0 < dlg.locator("li").count() < total, 3, lambda: dlg.locator("li").count())
    assert any("收藏" in t for t in dlg.locator("li").all_inner_texts())
    dlg.get_by_label("搜索快捷键").fill("完全不存在的动作")
    wait_until(lambda: dlg.locator("li").count() == 0, 3)
    app.page.keyboard.press("Escape")
    app.page.keyboard.press("Escape")
    dlg.wait_for(state="detached", timeout=3000)


@pytest.mark.case("E-KB-15")
def test_reload_keeps_state(app, sandbox):
    """F5 = WebView 整页刷新（CDP 合成按键不触发浏览器加速键，用 page.reload 等价模拟）。"""
    root = sandbox.files / "刷新监视"
    root.mkdir()
    app.seed([root] + seed_n(app, sandbox, 3))
    app.menu_click("刷新监视", "监视此文件夹")
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=8000)
    before = sorted((i["name"], i["id"]) for i in app.items())
    for _ in range(2):
        app.reload_page()
    app.wait_count(4)
    assert sorted((i["name"], i["id"]) for i in app.items()) == before
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=8000)
    # 空闲期没有成倍的轮询（重复初始化的定时器会让整表/视图重载在静置时持续出现）
    n0 = len(app.calls("get_items"))
    v0 = len(app.calls("view_query"))
    time.sleep(3)
    assert len(app.calls("get_items")) - n0 <= 1, app.calls("get_items")[n0:]
    assert len(app.calls("view_query")) - v0 <= 1, app.calls("view_query")[v0:]
    # 后端监视未因刷新重复注册：新文件只入库一次
    files.write(root / "刷新后新增.txt", "n")
    wait_until(lambda: any(i["name"] == "刷新后新增.txt" for i in app.items()), 10)
    time.sleep(1.5)
    assert sum(i["name"] == "刷新后新增.txt" for i in app.items()) == 1
    assert app.item("刷新后新增.txt")["hide_from_all"]
    # 夹内新文件入库但不铺满「全部」（与 E-WAT-01 同一有意行为变更）
    app.wait_count(4)
    assert "刷新后新增.txt" not in app.visible_names()
    app.page.get_by_role("button", name="显示目录内文件").click()
    app.wait_names(sorted([n for n, _ in before] + ["刷新后新增.txt"]))
    assert app.js_errors() == []
