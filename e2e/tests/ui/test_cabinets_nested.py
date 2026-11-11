"""文件柜嵌套（F16 方案 C，E-CAB-NEST-*）：单父树、父柜默认含全部子柜、可切「仅本柜」、关联文件夹柜只能是叶子。"""
from __future__ import annotations

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def cab_row(app, name):
    return app.page.locator("[data-drop-item-cabinet-id]").filter(has=app.page.get_by_text(name, exact=True)).first


def parent_of(sandbox, cid):
    return dbh.scalar(sandbox.db_path, "SELECT parent_id FROM cabinets WHERE id=?", (cid,))


def drag_cabinet(app, src, dst, where: str):
    """where: into（行中部）/ before / after。CDP 合成指针事件，不动系统鼠标。"""
    s, d = src.bounding_box(), dst.bounding_box()
    m = app.page.mouse
    m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
    m.down()
    m.move(s["x"] + s["width"] / 2 + 4, s["y"] + s["height"] / 2 + 8, steps=4)
    y = d["y"] + d["height"] * {"into": 0.5, "before": 0.12, "after": 0.88}[where]
    m.move(d["x"] + d["width"] / 2, y, steps=15)
    m.move(d["x"] + d["width"] / 2 + 1, y, steps=2)
    m.up()


def seed_tree(app, sandbox):
    paths = [files.write(sandbox.files / "nest" / n, n) for n in ("甲.txt", "乙.txt", "丙.txt", "丁.txt")]
    app.seed(paths)
    ids = {n: app.invoke("add_cabinet", {"name": n, "color": "#22c55e"})["id"] for n in ("资料", "项目", "归档")}
    item = {n: app.item(n)["id"] for n in ("甲.txt", "乙.txt", "丙.txt", "丁.txt")}
    app.invoke("add_items_to_cabinet", {"cabinetId": ids["资料"], "itemIds": [item["甲.txt"]]})
    app.invoke("add_items_to_cabinet", {"cabinetId": ids["项目"], "itemIds": [item["甲.txt"], item["乙.txt"]]})
    app.invoke("add_items_to_cabinet", {"cabinetId": ids["归档"], "itemIds": [item["丙.txt"]]})
    app.reload_page()
    app.sidebar_tab("文件柜")
    return ids, item


def count_badge(app, name) -> str:
    return cab_row(app, name).inner_text().split("\n")[-1].strip()


@pytest.mark.case("E-CAB-NEST-01")
def test_nest_by_drag_and_editor_parent_view_includes_children(app, sandbox):
    ids, _ = seed_tree(app, sandbox)
    # 拖到行中部 = 放进去
    drag_cabinet(app, cab_row(app, "项目"), cab_row(app, "资料"), "into")
    wait_until(lambda: parent_of(sandbox, ids["项目"]) == ids["资料"], 5, lambda: parent_of(sandbox, ids["项目"]))
    # 编辑弹窗「上级文件柜」= 资料 / 项目
    cab_row(app, "归档").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_test_id("cabinet-parent-select").select_option(label="资料 / 项目")
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    wait_until(lambda: parent_of(sandbox, ids["归档"]) == ids["项目"], 5)

    depth = lambda n: cab_row(app, n).locator("xpath=..").get_attribute("data-cabinet-depth")  # noqa: E731
    wait_until(lambda: (depth("资料"), depth("项目"), depth("归档")) == ("0", "1", "2"), 5,
               lambda: (depth("资料"), depth("项目"), depth("归档")))
    # 计数与默认视图同口径：并集去重（甲 乙 丙）
    wait_until(lambda: count_badge(app, "资料") == "3", 5, lambda: count_badge(app, "资料"))

    cab_row(app, "资料").click()
    wait_until(lambda: sorted(app.visible_names()) == ["丙.txt", "乙.txt", "甲.txt"], 8, app.visible_names)
    toggle = app.page.get_by_test_id("cabinet-only-self")
    assert toggle.inner_text().strip() == "含子柜"
    toggle.click()
    wait_until(lambda: app.visible_names() == ["甲.txt"], 8, app.visible_names)
    assert toggle.get_attribute("aria-pressed") == "true"
    # 偏好持久化
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "资料").click()
    wait_until(lambda: app.visible_names() == ["甲.txt"], 8, app.visible_names)
    app.page.get_by_test_id("cabinet-only-self").click()
    wait_until(lambda: len(app.visible_names()) == 3, 8, app.visible_names)

    # 折叠：子孙行隐藏；成员不继承写入（父柜 cabinet_items 仍只有甲）
    app.page.get_by_test_id(f"cabinet-toggle-{ids['资料']}").click()
    wait_until(lambda: cab_row(app, "项目").count() == 0, 5)
    app.page.get_by_test_id(f"cabinet-toggle-{ids['资料']}").click()
    cab_row(app, "项目").wait_for()
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM cabinet_items WHERE cabinet_id=?", (ids["资料"],)) == 1

    # 拖到行上缘 = 与目标同级（移出父柜到顶层）
    drag_cabinet(app, cab_row(app, "归档"), cab_row(app, "资料"), "before")
    wait_until(lambda: parent_of(sandbox, ids["归档"]) is None, 5, lambda: parent_of(sandbox, ids["归档"]))
    wait_until(lambda: sorted(app.visible_names()) == ["乙.txt", "甲.txt"], 8, app.visible_names)


@pytest.mark.case("E-CAB-NEST-02")
def test_nest_rules_cycle_linked_leaf_and_delete_moves_children_up(app, sandbox):
    ids, item = seed_tree(app, sandbox)
    assert app.invoke("set_cabinet_parent", {"id": ids["项目"], "parentId": ids["资料"]}) is None
    assert app.invoke("set_cabinet_parent", {"id": ids["归档"], "parentId": ids["项目"]}) is None
    # 防环：把祖先放进子孙被拒；拖放同样不生效
    assert "子柜" in (app.invoke_error("set_cabinet_parent", {"id": ids["资料"], "parentId": ids["归档"]}) or "")
    app.reload_page()
    app.sidebar_tab("文件柜")
    drag_cabinet(app, cab_row(app, "资料"), cab_row(app, "归档"), "into")
    app.page.wait_for_timeout(500)
    assert parent_of(sandbox, ids["资料"]) is None

    # 关联文件夹柜只能是叶子
    folder = sandbox.files / "linked"
    files.write(folder / "盘内.txt", "x")
    linked = app.invoke("add_cabinet", {"name": "盘柜", "color": "#22c55e"})["id"]
    app.invoke("set_cabinet_folder", {"id": linked, "folder": str(folder)})
    assert "最底层" in (app.invoke_error("set_cabinet_parent", {"id": ids["归档"], "parentId": linked}) or "")
    assert app.invoke("set_cabinet_parent", {"id": linked, "parentId": ids["资料"]}) is None
    assert "子柜" in (app.invoke_error("set_cabinet_folder", {"id": ids["项目"], "folder": str(folder)}) or "")

    # 父柜视图并入关联子柜（按路径的成员）
    wait_until(lambda: any(i["name"] == "盘内.txt" for i in app.items()), 15)
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "资料").click()
    wait_until(lambda: "盘内.txt" in app.visible_names() and "丙.txt" in app.visible_names(), 10, app.visible_names)

    # 删除中间柜：子柜上移一级、成员保留，父柜视图仍含孙柜成员
    cab_row(app, "项目").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_role("button", name="删除").click()
    dlg.get_by_role("button", name="确认删除").click()
    dlg.wait_for(state="hidden")
    wait_until(lambda: parent_of(sandbox, ids["归档"]) == ids["资料"], 5)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM cabinet_items WHERE cabinet_id=?", (ids["归档"],)) == 1
    wait_until(lambda: "丙.txt" in app.visible_names() and "乙.txt" not in app.visible_names(), 10, app.visible_names)
    assert item  # 对象仍在库
    assert {i["name"] for i in app.items()} >= {"甲.txt", "乙.txt", "丙.txt", "丁.txt"}
