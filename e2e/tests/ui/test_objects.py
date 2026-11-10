"""对象管理（E-OBJ-*）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until
from tests.ui.conftest import add_via_menu, folder_dialog_confirm


@pytest.mark.case("E-OBJ-01")
def test_add_files_button(app, sandbox, zoo):
    picks = [zoo["png"], zoo["txt"], zoo["bat"]]
    add_via_menu(app, "添加文件…", picks)
    app.wait_toast("已导入 3 个对象")
    call = app.calls("plugin:dialog|open")[-1]
    assert call["args"]["options"]["multiple"] is True
    app.wait_count(3)
    rows = dict(dbh.query(sandbox.db_path, "SELECT name, type FROM items"))
    assert rows == {"图片.png": "image", "笔记.txt": "text", "脚本.bat": "bat"}


# PR46 规格：contents/both 递归收入夹内文件与中间目录，投放的文件夹作为浏览入口留在「全部项目」，
# 夹内文件与中间目录 hide_from_all（总览默认不铺开，可逐级浏览/切换显示）。
NESTED = {"项目夹", "子目录", "a.txt", "b.png", "c.txt"}


@pytest.mark.parametrize("mode,expect,visible", [
    ("只加入文件夹", {"项目夹"}, {"项目夹"}),
    ("只加入里面的文件", NESTED, {"项目夹"}),
    ("两者都加入", NESTED, {"项目夹"}),
])
@pytest.mark.case("E-OBJ-02")
def test_add_folder_modes(app, sandbox, mode, expect, visible):
    root = sandbox.files / "项目夹"
    files.write(root / "a.txt", "a")
    files.write(root / "b.png", files.png_bytes())
    files.write(root / "子目录" / "c.txt", "c")
    add_via_menu(app, "添加文件夹…", [root])
    dlg = app.dialog("添加文件夹")
    assert "项目夹" in dlg.inner_text()
    folder_dialog_confirm(app, mode)
    wait_until(lambda: {i["name"] for i in app.items()} == expect, 8, lambda: [i["name"] for i in app.items()])
    app.wait_toast(f"已导入 {len(expect)} 个对象")
    shown = {i["name"] for i in app.items() if not i.get("hide_from_all")}
    assert shown == visible, app.items()
    assert app.item("项目夹")["type"] == "folder"
    if "子目录" in expect:
        assert app.item("子目录")["type"] == "folder"


@pytest.mark.case("E-OBJ-05")
def test_drag_drop_mixed(app, sandbox, zoo):
    folder = sandbox.files / "拖入夹"
    files.write(folder / "inner.txt", "x")
    app.drop_paths([str(zoo["png"]), str(zoo["mp3"]), str(zoo["md"]), str(folder)])
    folder_dialog_confirm(app, "只加入文件夹")
    wait_until(lambda: len(app.items()) == 4, 8)
    assert {i["name"] for i in app.items()} == {"图片.png", "音乐.mp3", "说明.md", "拖入夹"}


@pytest.mark.case("E-OBJ-06")
def test_drop_dedupe_window(app, zoo):
    paths = [str(zoo["txt"]), str(zoo["md"])]
    app.drop_paths(paths, via="native")
    time.sleep(0.3)
    app.drop_paths(paths, via="dom")
    app.wait_toast("这批文件刚刚已导入")
    time.sleep(0.5)
    assert len(app.calls("add_items")) == 1
    assert len(app.items()) == 2


@pytest.mark.case("E-OBJ-08")
def test_duplicate_import(app, sandbox, zoo):
    add_via_menu(app, "添加文件…", [zoo["txt"]])
    app.wait_toast("已导入 1 个对象")
    app.clear_toasts()
    add_via_menu(app, "添加文件…", [zoo["txt"]])
    app.wait_toast("1 个对象已存在，无需导入")
    app.clear_toasts()
    upper = str(zoo["txt"]).upper()
    add_via_menu(app, "添加文件…", [upper, zoo["md"]])
    app.wait_toast("已导入 1 个对象，1 个已存在跳过")
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 2


@pytest.mark.case("E-OBJ-10")
def test_type_detection(app, sandbox, zoo):
    app.seed(zoo.values())
    want = {"示例文件夹": "folder", "图片.png": "image", "照片.jpg": "image", "音乐.mp3": "audio",
            "声音.wav": "audio", "视频.mp4": "video", "工具.exe": "exe", "脚本.bat": "bat",
            "脚本.ps1": "ps1", "笔记.txt": "text", "说明.md": "text", "LICENSE": "exe"}
    assert dict(dbh.query(sandbox.db_path, "SELECT name, type FROM items")) == want
    labels = {"folder": "文件夹", "image": "图片", "audio": "音频", "video": "视频", "text": "文本",
              "exe": "程序", "bat": "脚本", "ps1": "脚本"}
    for name, t in want.items():
        card = app.card(name)
        card.scroll_into_view_if_needed()
        assert card.locator(".instrument-label").inner_text().strip() == labels[t], name
    # 无后缀：后缀徽标隐藏（设计如此，见单测）
    assert app.card("LICENSE").locator(".data-readout").count() == 0
    assert app.card("笔记.txt").locator(".data-readout").inner_text().strip().lower().lstrip(".") == "txt"


@pytest.mark.case("E-OBJ-11")
def test_remove_from_library_confirm(app, sandbox, zoo):
    app.seed([zoo["txt"], zoo["md"], zoo["png"]])
    app.menu_click("笔记.txt", "从库中移除")
    dlg = app.dialog("移出库")
    dlg.get_by_role("button", name="从库中移除时不再询问（删除本地文件仍会逐次确认）").click()
    dlg.get_by_role("button", name="从库中移除", exact=True).click()
    dlg.wait_for(state="detached", timeout=5000)
    app.wait_count(2)
    assert zoo["txt"].exists()
    # 第二次直接移除，无确认框
    app.menu_click("说明.md", "从库中移除")
    app.wait_count(1)
    assert app.page.get_by_role("dialog", name="移出库").count() == 0
    assert zoo["md"].exists()
    assert [i["name"] for i in app.items()] == ["图片.png"]


@pytest.mark.case("E-OBJ-11")
def test_batch_remove_confirm(app, zoo):
    app.seed([zoo["txt"], zoo["md"], zoo["png"]])
    app.card("笔记.txt").click()
    app.card("图片.png").click(modifiers=["Control"])
    app.menu_click("图片.png", "从库中移除 2 项")
    dlg = app.dialog("移出库 2 项")
    dlg.get_by_role("button", name="从库中移除", exact=True).click()
    app.wait_count(1)
    assert zoo["txt"].exists() and zoo["png"].exists()


@pytest.mark.case("E-OBJ-15")
def test_edit_note(app, sandbox, zoo):
    app.seed([zoo["txt"], zoo["md"]])
    app.menu_click("笔记.txt", "编辑备注…")
    dlg = app.dialog("编辑备注")
    dlg.get_by_label("备注内容").fill("第一行 账号提示\n第二行 独特备注词")
    dlg.get_by_label("备注内容").press("Control+Enter")
    dlg.wait_for(state="detached", timeout=5000)
    assert app.item("笔记.txt")["note"] == "第一行 账号提示\n第二行 独特备注词"
    app.card("笔记.txt").get_by_role("img", name="有备注").wait_for(timeout=5000)
    search = app.page.locator("#workspace-search")
    search.fill("独特备注词")
    wait_until(lambda: app.visible_names() == ["笔记.txt"], 8, lambda: app.visible_names())


@pytest.mark.case("E-OBJ-16")
def test_rename_f2(app, sandbox, zoo):
    app.seed([zoo["txt"]])
    app.card("笔记.txt").click()
    app.page.keyboard.press("F2")
    dlg = app.dialog("重命名")
    box = dlg.get_by_label("新名称")
    box.fill("改名后.txt")
    box.press("Enter")
    dlg.wait_for(state="detached", timeout=5000)
    new = zoo["txt"].with_name("改名后.txt")
    wait_until(lambda: new.exists() and not zoo["txt"].exists(), 5)
    it = app.items()[0]
    assert it["name"] == "改名后.txt" and it["path"].lower() == str(new).lower()
    wait_until(lambda: app.visible_names() == ["改名后.txt"], 5)


@pytest.mark.case("E-OBJ-18")
def test_batch_rename_template(app, sandbox):
    paths = [files.write(sandbox.files / "批量" / f"原{i}.txt", str(i)) for i in range(5)]
    app.seed(paths)
    app.card("原0.txt").click()
    app.page.keyboard.press("Control+a")
    tb = app.page.get_by_test_id("batch-toolbar")
    tb.get_by_role("button", name="重命名").click()
    dlg = app.dialog("批量重命名")
    dlg.get_by_role("button", name="规则类型").click()
    app.page.get_by_role("option", name="模板").click()
    dlg.get_by_label("模板").fill("doc-{n}")
    dlg.get_by_label("序号起始值").fill("7")
    dlg.get_by_label("序号补零位数").fill("3")
    preview = [r for r in dlg.locator("tbody tr").all_inner_texts()]
    new_names = sorted(line.split("\t")[1].strip() for line in preview)
    assert new_names == [f"doc-{n:03d}.txt" for n in range(7, 12)], preview
    dlg.get_by_role("button", name="执行（5）").click()
    dlg.get_by_role("button", name="完成").wait_for(timeout=8000)
    on_disk = sorted(p.name for p in (sandbox.files / "批量").iterdir())
    assert on_disk == new_names
    assert sorted(i["name"] for i in app.items()) == new_names
    dlg.get_by_role("button", name="完成").click()


@pytest.mark.case("E-OBJ-20")
def test_copy_paths(app, zoo):
    app.seed([zoo["txt"], zoo["md"]])
    app.card("笔记.txt").click()
    app.page.keyboard.press("Control+c")
    app.wait_toast("已复制路径")
    assert app.clipboard()[-1] == str(zoo["txt"])
    app.menu_click("说明.md", "复制路径")
    wait_until(lambda: app.clipboard()[-1] == str(zoo["md"]), 3)
    app.card("笔记.txt").click()
    app.card("说明.md").click(modifiers=["Control"])
    app.get_toolbar().get_by_role("button", name="复制路径").click()
    app.wait_toast("已复制 2 条路径")
    assert set(app.clipboard()[-1].split("\n")) == {str(zoo["txt"]), str(zoo["md"])}
    app.menu_click("说明.md", "复制 2 条路径")
    assert len(app.clipboard()) == 4
