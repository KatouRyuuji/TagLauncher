"""文件柜（E-CAB-*）。"""
from __future__ import annotations

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def members(sandbox, cab_id):
    return sorted(r[0] for r in dbh.query(sandbox.db_path,
                  "SELECT i.name FROM cabinet_items ci JOIN items i ON i.id=ci.item_id WHERE ci.cabinet_id=?", (cab_id,)))


def cab_row(app, name):
    return app.page.locator("[data-drop-item-cabinet-id]").filter(has=app.page.get_by_text(name, exact=True)).first


def seed(app, sandbox, names):
    paths = [files.write(sandbox.files / "cab" / n, n) for n in names]
    app.seed(paths)
    return paths


def new_cabinet(app, sandbox, name):
    res = app.invoke("add_cabinet", {"name": name, "color": "#22c55e"})
    return res["id"]


@pytest.mark.case("E-CAB-01")
def test_cabinet_crud(app, sandbox):
    seed(app, sandbox, ["柜内.txt"])
    app.sidebar_tab("文件柜")
    app.page.get_by_role("button", name="新建文件柜").click()
    dlg = app.page.get_by_role("dialog", name="新建文件柜")
    dlg.get_by_placeholder("文件柜名称").fill("资料柜")
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    cab_row(app, "资料柜").wait_for()
    cid = dbh.scalar(sandbox.db_path, "SELECT id FROM cabinets WHERE name='资料柜'")
    app.invoke("add_item_to_cabinet", {"cabinetId": cid, "itemId": app.item("柜内.txt")["id"]})

    cab_row(app, "资料柜").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_placeholder("文件柜名称").fill("资料柜2")
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    cab_row(app, "资料柜2").wait_for()
    assert dbh.scalar(sandbox.db_path, "SELECT name FROM cabinets WHERE id=?", (cid,)) == "资料柜2"

    cab_row(app, "资料柜2").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_role("button", name="删除").click()
    dlg.get_by_role("button", name="确认删除").click()
    dlg.wait_for(state="hidden")
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM cabinets") == 0, 5)
    assert any(i["name"] == "柜内.txt" for i in app.items())


@pytest.mark.case("E-CAB-02")
def test_add_to_cabinet_three_ways(app, sandbox):
    seed(app, sandbox, ["右键.txt", "拖入.txt", "工具条.txt"])
    cid = new_cabinet(app, sandbox, "收纳")
    app.reload_page()
    # 1) 右键子菜单
    menu = app.context_menu("右键.txt")
    trig = menu.get_by_role("menuitem", name="添加到文件柜")
    menu_el = app.page.locator("[role=menu]").first
    sandbox.artifacts.mkdir(parents=True, exist_ok=True)
    before = menu_el.bounding_box()
    trig.hover()
    # 采样 1 秒：主菜单位置与子菜单是否稳定（BUG-06：贴近窗口底部时 hover 子菜单触发主菜单来回位移）
    samples = []
    for _ in range(20):
        samples.append((round(menu_el.bounding_box()["y"]), app.page.get_by_role("menuitem", name="收纳", exact=True).count()))
        app.page.wait_for_timeout(50)
    (sandbox.artifacts / "menu-samples.txt").write_text(repr({"before": before, "samples": samples}), encoding="utf-8")
    flicker = sum(1 for a, b in zip(samples, samples[1:]) if a != b) >= 3
    # BUG-06 回归：贴底展开子菜单时主菜单不再来回跳动，鼠标可直接进入子菜单
    if flicker:
        app.page.screenshot(path=str(sandbox.artifacts / "bug06-menu.png"))
    assert not flicker, f"主菜单/子菜单不稳定：{samples}"
    sub_item = app.page.get_by_role("menuitem", name="收纳", exact=True)
    sub_item.click()
    app.wait_toast("已加入文件柜「收纳」")
    # 2) 拖拽卡片到侧栏文件柜
    app.sidebar_tab("文件柜")
    row = cab_row(app, "收纳")
    s = app.card("拖入.txt").bounding_box()
    d = row.bounding_box()
    m = app.page.mouse
    m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
    m.down()
    m.move(s["x"] + s["width"] / 2 + 15, s["y"] + s["height"] / 2 + 15, steps=5)
    m.move(d["x"] + d["width"] / 2, d["y"] + d["height"] / 2, steps=15)
    m.up()
    wait_until(lambda: "拖入.txt" in members(sandbox, cid), 5, lambda: members(sandbox, cid))
    # 3) 工具条（拖放结束后产品有 250ms 防误触窗口，期间点击会被吞掉：等过窗口再点）
    app.page.keyboard.press("Escape")
    app.page.wait_for_timeout(300)
    app.card("工具条.txt").click()
    wait_until(lambda: len(app.selected_ids()) == 1, 3, lambda: app.selected_ids())
    bar = app.get_toolbar()
    bar.get_by_role("button", name="文件柜").click()
    app.page.locator("[data-floating-menu][role=menu]").get_by_role("menuitem", name="加入 收纳").click()
    wait_until(lambda: members(sandbox, cid) == sorted(["右键.txt", "拖入.txt", "工具条.txt"]), 5,
               lambda: (members(sandbox, cid), app.calls("add_items_to_cabinet"), app.calls("add_item_to_cabinet")[-1:], app.toasts()))
    wait_until(lambda: "3" in row.inner_text(), 5, lambda: row.inner_text())


@pytest.mark.case("E-CAB-03")
def test_remove_from_cabinet(app, sandbox):
    seed(app, sandbox, ["移出1.txt", "移出2.txt"])
    cid = new_cabinet(app, sandbox, "临时")
    app.invoke("add_items_to_cabinet", {"cabinetId": cid, "itemIds": [i["id"] for i in app.items()]})
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "临时").click()
    app.wait_names(["移出1.txt", "移出2.txt"])
    app.menu_click("移出1.txt", "移出文件柜 · 临时")
    wait_until(lambda: members(sandbox, cid) == ["移出2.txt"], 5, lambda: members(sandbox, cid))
    app.wait_names(["移出2.txt"])
    app.card("移出2.txt").click()
    app.get_toolbar().get_by_role("button", name="文件柜").click()
    app.page.locator("[data-floating-menu][role=menu]").get_by_role("menuitem", name="从当前文件柜移出").click()
    wait_until(lambda: members(sandbox, cid) == [], 5)
    assert len(app.items()) == 2


@pytest.mark.case("E-CAB-05")
def test_linked_folder(app, sandbox):
    seed(app, sandbox, ["手动成员.txt"])
    folder = sandbox.files / "关联夹"
    files.write(folder / "夹内1.txt", "1")
    files.write(folder / "夹内2.txt", "2")
    cid = new_cabinet(app, sandbox, "同步柜")
    app.invoke("add_item_to_cabinet", {"cabinetId": cid, "itemId": app.item("手动成员.txt")["id"]})
    app.reload_page()
    app.stub("plugin:dialog|open", str(folder))
    app.sidebar_tab("文件柜")
    cab_row(app, "同步柜").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_role("button", name="选择文件夹…").click()
    dlg.get_by_title(str(folder)).wait_for()
    dlg.get_by_role("button", name="保存").click()
    # 可能有二次确认
    confirm = app.page.get_by_role("button", name="确认关联")
    if confirm.count():
        confirm.click()
    def cab_names():
        return sorted(i["name"] for i in app.invoke("get_cabinet_items", {"cabinetId": cid, "includeVisuals": False}))
    wait_until(lambda: cab_names() == ["夹内1.txt", "夹内2.txt"], 10, cab_names)
    cab_row(app, "同步柜").click()
    app.wait_names(["夹内1.txt", "夹内2.txt"])
    assert dbh.scalar(sandbox.db_path, "SELECT folder_path FROM cabinets WHERE id=?", (cid,)).lower() == str(folder).lower()
    assert any(i["name"] == "手动成员.txt" for i in app.items())
