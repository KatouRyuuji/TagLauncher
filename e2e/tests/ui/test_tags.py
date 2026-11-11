"""标签（E-TAG-*）。"""
from __future__ import annotations


import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def item_tag_names(sandbox, item_id):
    return [r[0] for r in dbh.query(sandbox.db_path,
            "SELECT t.name FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=? ORDER BY it.position",
            (item_id,))]


def seed_files(app, sandbox, names):
    paths = [files.write(sandbox.files / "tags" / n, n) for n in names]
    app.seed(paths)
    return paths


def setup_tags(app, names):
    for n in names:
        app.add_tag(n)
    app.reload_page()


def tag_editor(app, title):
    return app.page.get_by_role("dialog", name=title)


@pytest.mark.case("E-TAG-01")
def test_create_tag(app, sandbox):
    app.page.get_by_role("button", name="新建标签").click()
    dlg = tag_editor(app, "新建标签")
    dlg.get_by_placeholder("标签名称").fill("工作")
    radios = dlg.get_by_role("radiogroup", name="分类颜色").get_by_role("radio")
    pick = radios.nth(2)
    color_name = pick.get_attribute("aria-label")
    pick.click()
    assert pick.get_attribute("aria-checked") == "true"
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    app.sidebar_tag("工作").wait_for()
    rows = dbh.query(sandbox.db_path, "SELECT name, color FROM tags")
    assert len(rows) == 1 and rows[0][0] == "工作"
    assert rows[0][1], f"颜色为空（选择了 {color_name}）"


@pytest.mark.case("E-TAG-02")
def test_edit_and_delete_tag(app, sandbox):
    (p,) = seed_files(app, sandbox, ["带标签.txt"])
    tid = app.add_tag("旧名", "#ef4444")
    app.invoke("set_item_tags", {"itemId": app.item("带标签.txt")["id"], "tagIds": [tid]})
    app.reload_page()
    app.sidebar_tag("旧名").click(button="right")
    dlg = tag_editor(app, "编辑标签")
    dlg.get_by_placeholder("标签名称").fill("新名")
    radios = dlg.get_by_role("radiogroup", name="分类颜色").get_by_role("radio")
    radios.nth(4).click()
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    app.sidebar_tag("新名").wait_for()
    name, color = dbh.query(sandbox.db_path, "SELECT name, color FROM tags WHERE id=?", (tid,))[0]
    assert name == "新名" and color.lower() != "#ef4444"

    app.sidebar_tag("新名").click(button="right")
    dlg = tag_editor(app, "编辑标签")
    dlg.get_by_role("button", name="删除").click()
    dlg.get_by_role("button", name="确认删除").click()
    dlg.wait_for(state="hidden")
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM tags") == 0, 5)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM item_tags") == 0
    wait_until(lambda: app.page.locator("[data-tag-row-id]").count() == 0, 5, "删除后侧栏仍有标签行")
    assert any(i["name"] == "带标签.txt" for i in app.items())


@pytest.mark.case("E-TAG-04")
def test_item_tags_dialog(app, sandbox):
    seed_files(app, sandbox, ["打标.txt"])
    setup_tags(app, ["甲", "乙"])
    app.menu_click("打标.txt", "管理标签")
    dlg = app.dialog("管理项目标签")
    dlg.get_by_role("button", name="乙", exact=True).click()
    dlg.get_by_role("button", name="甲", exact=True).click()
    dlg.get_by_label("新标签名称").fill("丙")
    dlg.get_by_role("button", name="创建").click()
    dlg.get_by_role("button", name="移除已选标签「丙」").wait_for()
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    iid = app.item("打标.txt")["id"]
    wait_until(lambda: len(item_tag_names(sandbox, iid)) == 3, 5, lambda: item_tag_names(sandbox, iid))
    assert item_tag_names(sandbox, iid) == ["乙", "甲", "丙"]


@pytest.mark.case("E-TAG-05")
def test_drag_tag_onto_card(app, sandbox):
    (p,) = seed_files(app, sandbox, ["拖标签.txt"])
    setup_tags(app, ["拖拽"])
    src = app.sidebar_tag("拖拽")
    dst = app.card("拖标签.txt")
    s = src.bounding_box()
    d = dst.bounding_box()
    m = app.page.mouse
    m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
    m.down()
    m.move(s["x"] + s["width"] / 2 + 20, s["y"] + s["height"] / 2 + 10, steps=5)
    m.move(d["x"] + d["width"] / 2, d["y"] + d["height"] / 2, steps=15)
    m.up()
    iid = app.item("拖标签.txt")["id"]
    wait_until(lambda: item_tag_names(sandbox, iid) == ["拖拽"], 5, lambda: item_tag_names(sandbox, iid))
    assert p.exists() and app.item("拖标签.txt")["path"].lower() == str(p).lower()


@pytest.mark.case("E-TAG-06")
def test_batch_add_remove_tag(app, sandbox):
    seed_files(app, sandbox, ["批1.txt", "批2.txt", "批3.txt"])
    setup_tags(app, ["批量"])
    app.card("批1.txt").click()
    app.card("批3.txt").click(modifiers=["Shift"])
    bar = app.get_toolbar()
    bar.get_by_role("button", name="加入标签").click()
    app.page.locator("[data-floating-menu][role=menu]").get_by_role("menuitem", name="批量").click()
    ids = [app.item(n)["id"] for n in ("批1.txt", "批2.txt", "批3.txt")]
    wait_until(lambda: all(item_tag_names(sandbox, i) == ["批量"] for i in ids), 5)
    bar.get_by_role("button", name="移除标签").click()
    app.page.locator("[data-floating-menu][role=menu]").get_by_role("menuitem", name="批量").click()
    wait_until(lambda: all(item_tag_names(sandbox, i) == [] for i in ids), 5)


@pytest.mark.case("E-TAG-07")
def test_tag_filter_intersection(app, sandbox):
    seed_files(app, sandbox, ["只A.txt", "只B.txt", "AB.txt"])
    a = app.add_tag("标A")
    b = app.add_tag("标B")
    for n, t in (("只A.txt", [a]), ("只B.txt", [b]), ("AB.txt", [a, b])):
        app.invoke("set_item_tags", {"itemId": app.item(n)["id"], "tagIds": t})
    app.reload_page()
    app.sidebar_tag("标A").click()
    app.wait_names(["只A.txt", "AB.txt"])
    app.sidebar_tag("标B").click()
    app.wait_names(["AB.txt"])
    bar = app.page.get_by_label("已选标签（同时满足）")
    assert "且" in bar.inner_text()
    app.page.get_by_role("button", name="清空标签筛选").click()
    app.wait_names(["只A.txt", "只B.txt", "AB.txt"])


@pytest.mark.case("E-TAG-09")
def test_tag_relations_editor(app, sandbox):
    setup_tags(app, ["父", "子"])
    app.page.get_by_role("button", name="管理标签父子关系").click()
    dlg = app.dialog("标签关系")
    dlg.get_by_role("button", name="子", exact=True).first.click()
    dlg.get_by_role("button", name="添加父标签「父」", exact=True).click()
    dlg.get_by_role("button", name="移除父标签「父」").wait_for()
    ids = app.tag_ids()
    wait_until(lambda: dbh.query(sandbox.db_path, "SELECT parent_id, child_id FROM tag_relations") == [(ids["父"], ids["子"])], 5)
    dlg.press("Escape")
    dlg.wait_for(state="hidden")
    row = app.page.locator(f'[data-tag-row-id="{ids["子"]}"][data-tag-parent-id="{ids["父"]}"]')
    row.wait_for()
    assert "ml-3" in (row.locator("xpath=..").get_attribute("class") or "")

    app.page.get_by_role("button", name="管理标签父子关系").click()
    dlg = app.dialog("标签关系")
    dlg.get_by_role("button", name="子", exact=True).first.click()
    dlg.get_by_role("button", name="移除父标签「父」").click()
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM tag_relations") == 0, 5)


@pytest.mark.case("E-TAG-11")
def test_parent_includes_descendants(app, sandbox):
    seed_files(app, sandbox, ["父对象.txt", "子对象.txt", "无关.txt"])
    p = app.add_tag("集合")
    c = app.add_tag("子集")
    app.invoke("add_tag_relation", {"parentId": p, "childId": c})
    app.invoke("set_item_tags", {"itemId": app.item("父对象.txt")["id"], "tagIds": [p]})
    app.invoke("set_item_tags", {"itemId": app.item("子对象.txt")["id"], "tagIds": [c]})
    app.reload_page()
    app.page.locator(f'[data-tag-row-id="{p}"]').first.click()
    app.wait_names(["父对象.txt", "子对象.txt"])
