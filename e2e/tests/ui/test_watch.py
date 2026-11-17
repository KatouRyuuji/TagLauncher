"""文件夹监视（E-WAT-*）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


@pytest.mark.case("E-WAT-01", "E-WAT-02")
def test_watch_and_unwatch(app, sandbox):
    root = sandbox.files / "监视目录"
    root.mkdir()
    app.seed([root])
    app.menu_click("监视目录", "监视此文件夹")
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=8000)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM watch_roots WHERE enabled=1") == 1
    time.sleep(0.5)
    files.write(root / "新来的.txt", "hi")
    wait_until(lambda: any(i["name"] == "新来的.txt" for i in app.items()), 10, lambda: [i["name"] for i in app.items()])
    assert app.item("新来的.txt")["hide_from_all"] and not app.item("监视目录")["hide_from_all"]
    # 有意行为变更：夹内文件默认不铺满「全部」；打开「显示目录内文件」后才出现。
    app.wait_count(1)
    assert "新来的.txt" not in app.visible_names()
    app.page.get_by_role("button", name="显示目录内文件").click()
    app.wait_count(2)
    assert "新来的.txt" in app.visible_names()
    app.page.get_by_role("button", name="隐藏目录内文件").click()
    app.wait_count(1)
    assert "新来的.txt" not in app.visible_names()

    app.menu_click("监视目录", "停止监视此文件夹")
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM watch_roots WHERE enabled=1") == 0, 5)
    files.write(root / "不该入库.txt", "no")
    time.sleep(4)
    assert not any(i["name"] == "不该入库.txt" for i in app.items())


@pytest.mark.case("E-WAT-08")
def test_linked_cabinet_import_hidden_from_all(app, sandbox):
    """关联柜同步入库的夹内文件默认不铺满「全部」，柜视图仍可浏览。"""
    from tests.ui.test_cabinets import cab_row, new_cabinet

    root = sandbox.files / "关联夹"
    files.write(root / "顶层.txt", "1")
    files.write(root / "子目录" / "深处.txt", "2")
    cid = new_cabinet(app, sandbox, "关联柜")
    app.invoke("set_cabinet_folder", {"id": cid, "folder": str(root)})
    wait_until(
        lambda: {"顶层.txt", "子目录", "深处.txt"} <= {i["name"] for i in app.items()},
        15,
        lambda: [i["name"] for i in app.items()],
    )
    items = {i["name"]: i for i in app.items()}
    assert all(items[n]["hide_from_all"] for n in ("顶层.txt", "子目录", "深处.txt"))
    app.reload_page()
    app.wait_count(0)
    assert not ({"顶层.txt", "子目录", "深处.txt"} & set(app.visible_names()))
    app.page.get_by_role("button", name="显示目录内文件").click()
    app.wait_count(3)
    assert {"顶层.txt", "子目录", "深处.txt"} <= set(app.visible_names())
    app.page.get_by_role("button", name="隐藏目录内文件").click()
    app.wait_count(0)

    app.sidebar_tab("文件柜")
    cab_row(app, "关联柜").click()
    app.wait_names(["子目录", "顶层.txt"])
