"""键盘（E-KB-*）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def focused_is_search(app) -> bool:
    return app.page.evaluate("() => document.activeElement && document.activeElement.id === 'workspace-search'")


def blur(app):
    app.page.evaluate("() => document.activeElement && document.activeElement.blur()")


def seed_n(app, sandbox, n):
    paths = [files.write(sandbox.files / "kb" / f"键{i:02d}.txt", str(i)) for i in range(n)]
    app.seed(paths)
    return paths


@pytest.mark.case("E-KB-01")
@pytest.mark.parametrize("key", ["F3", "/", "Control+f"])
def test_focus_search_keys(app, key):
    blur(app)
    assert not focused_is_search(app)
    app.page.keyboard.press(key)
    wait_until(lambda: focused_is_search(app), 3)


@pytest.mark.case("E-KB-02")
def test_arrow_home_end(app, sandbox):
    seed_n(app, sandbox, 12)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    names = app.visible_names()
    ids = {i["name"]: i["id"] for i in app.items()}
    app.select_card(names[0])
    sel = app.selected_ids
    app.page.keyboard.press("ArrowDown")
    wait_until(lambda: sel() == [ids[names[1]]], 3, sel)
    app.page.keyboard.press("End")
    wait_until(lambda: sel() == [ids[names[-1]]], 3, sel)
    app.page.keyboard.press("Home")
    wait_until(lambda: sel() == [ids[names[0]]], 3, sel)
    app.page.keyboard.press("PageDown")
    wait_until(lambda: sel() and sel() != [ids[names[0]]], 3, sel)
    app.page.keyboard.press("PageUp")
    assert app.selected_ids() == [ids[names[0]]]


@pytest.mark.case("E-KB-04")
def test_enter_launch_space_preview(app, sandbox):
    bat = files.marker_exe(sandbox.files / "kb" / "回车.exe")
    png = files.write(sandbox.files / "kb" / "预览.png", files.png_bytes(40, 30))
    app.seed([bat, png])
    app.card("回车.exe").click()
    app.page.keyboard.press("Enter")
    files.wait_marker(bat)
    app.card("预览.png").click()
    app.page.keyboard.press(" ")
    pv = app.page.get_by_role("dialog", name="快速预览")
    pv.wait_for()
    app.page.keyboard.press("Escape")
    pv.wait_for(state="hidden")


@pytest.mark.case("E-KB-05")
def test_ctrl_d_ctrl_c(app, sandbox):
    (p,) = seed_n(app, sandbox, 1)
    app.card(p.name).click()
    app.page.keyboard.press("Control+d")
    wait_until(lambda: app.item(p.name)["is_favorite"], 3)
    # 等前端拿到 get_items_by_ids 回包再按第二次（否则 UI 仍认为未收藏，会再次“收藏”）
    wait_until(lambda: any(c.get("done") for c in app.calls("get_items_by_ids")), 3, lambda: app.calls("get_items_by_ids"))
    app.page.wait_for_timeout(300)
    app.page.keyboard.press("Control+d")
    wait_until(lambda: not app.item(p.name)["is_favorite"], 3)
    app.page.keyboard.press("Control+c")
    app.wait_toast("已复制路径")
    assert app.clipboard()[-1] == app.item(p.name)["path"]


@pytest.mark.case("E-KB-06")
def test_f2_delete_backspace(app, sandbox):
    root = sandbox.files / "浏览根"
    files.write(root / "子夹" / "里面.txt", "x")
    files.write(root / "顶层.txt", "y")
    (p,) = seed_n(app, sandbox, 1)
    app.card(p.name).click()
    app.page.keyboard.press("F2")
    dlg = app.dialog("重命名")
    dlg.wait_for()
    app.page.keyboard.press("Escape")
    dlg.wait_for(state="hidden")
    app.card(p.name).click()
    app.page.keyboard.press("Delete")
    dlg = app.dialog("移出库")
    dlg.wait_for()
    app.page.keyboard.press("Escape")
    dlg.wait_for(state="hidden")
    assert any(i["name"] == p.name for i in app.items())
    # Backspace：关联文件柜目录浏览中返回上一级
    cab = app.invoke("add_cabinet", {"name": "浏览柜", "color": "#22c55e"})
    app.invoke("set_cabinet_folder", {"id": cab["id"], "folder": str(root)})
    app.reload_page()
    app.sidebar_tab("文件柜")
    app.page.locator(f'[data-drop-item-cabinet-id="{cab["id"]}"]').click()
    app.card("子夹").wait_for(timeout=10_000)
    app.card("子夹").dblclick()
    app.wait_names(["里面.txt"])
    blur(app)
    app.page.keyboard.press("Backspace")
    wait_until(lambda: "顶层.txt" in app.visible_names(), 5, lambda: app.visible_names())


@pytest.mark.case("E-KB-09")
def test_settings_help_escape(app):
    blur(app)
    app.page.keyboard.press("Control+,")
    st = app.page.locator('[aria-labelledby="settings-panel-title"]')
    st.wait_for()
    app.page.keyboard.press("Escape")
    st.wait_for(state="hidden")
    blur(app)
    app.page.keyboard.press("?")
    hp = app.page.locator('[aria-labelledby="shortcuts-help-title"]')
    hp.wait_for()
    app.page.keyboard.press("Escape")
    hp.wait_for(state="hidden")


@pytest.mark.case("E-KB-11")
def test_inputs_swallow_global_shortcuts(app, sandbox):
    (p,) = seed_n(app, sandbox, 1)
    app.menu_click(p.name, "编辑备注…")
    dlg = app.dialog("编辑备注")
    ta = dlg.get_by_label("备注内容")
    ta.click()
    ta.press_sequentially("a b?", delay=20)
    app.page.keyboard.press("Backspace")
    app.page.keyboard.press("Delete")
    assert ta.input_value() == "a b"
    assert app.page.locator('[aria-labelledby="shortcuts-help-title"]').count() == 0
    assert app.page.get_by_role("dialog", name="快速预览").count() == 0
    assert app.page.get_by_role("dialog", name="移出库").count() == 0
    app.page.keyboard.press("Escape")
    app.menu_click(p.name, "重命名…")
    dlg = app.dialog("重命名")
    inp = dlg.get_by_label("新名称")
    inp.press("End")
    inp.press("Backspace")
    inp.press("Delete")
    inp.press_sequentially(" ?", delay=20)
    assert inp.input_value().endswith(" ?")
    assert app.page.locator('[aria-labelledby="shortcuts-help-title"]').count() == 0
    app.page.keyboard.press("Escape")
    assert any(i["name"] == p.name for i in app.items())


PALETTE = [
    ("网格视图", lambda app: app.page.get_by_role("button", name="网格视图", exact=True).get_attribute("aria-pressed") == "true"),
    ("列表视图", lambda app: app.page.get_by_role("button", name="列表视图", exact=True).get_attribute("aria-pressed") == "true"),
    ("大图标视图", lambda app: app.page.get_by_role("button", name="大图标视图", exact=True).get_attribute("aria-pressed") == "true"),
    ("聚焦搜索", focused_is_search),
    ("刷新", lambda app: len(app.calls("reconcile_items")) > 0),
    ("打开设置", lambda app: app.page.locator('[aria-labelledby="settings-panel-title"]').count() == 1),
    ("打开标签图谱", lambda app: app.page.get_by_role("dialog").count() >= 1),
    ("快捷键一览", lambda app: app.page.locator('[aria-labelledby="shortcuts-help-title"]').count() == 1),
    ("查看失效项目", lambda app: app.page.get_by_role("dialog", name="失效项目").count() == 1),
    ("清空筛选", lambda app: app.page.locator("#workspace-search").input_value() == ""),
    ("添加文件", lambda app: len(app.calls("plugin:dialog|open")) > 0),
    ("添加文件夹", lambda app: len(app.calls("plugin:dialog|open")) > 0),
    ("关于 TagLauncher", lambda app: app.page.get_by_role("dialog").count() >= 1),
]


@pytest.mark.case("E-KB-12")
@pytest.mark.parametrize("title,check", PALETTE, ids=[t for t, _ in PALETTE])
def test_palette_commands(app, sandbox, title, check):
    seed_n(app, sandbox, 1)
    app.stub("plugin:dialog|open", None)
    if title == "网格视图":
        app.page.get_by_role("button", name="列表视图", exact=True).click()
    if title == "清空筛选":
        app.search("zzz")
    if title == "查看失效项目":  # 无失效项时对话框会自动关闭：先造一个失效项
        gone = files.write(sandbox.files / "kb" / "将失效.txt", "x")
        app.seed([gone])
        gone.unlink()
        app.invoke("reconcile_items", {"force": True, "wait": True})
        app.reload_page()
    app.run_command(title)
    wait_until(lambda: check(app), 5, f"命令「{title}」未生效")
    assert app.js_errors() == []
