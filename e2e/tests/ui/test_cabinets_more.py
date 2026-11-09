"""文件柜补充用例（E-CAB-04/06/07/08/09/10/11）。"""
from __future__ import annotations

import os
import re
import shutil

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

from .test_cabinets import cab_row, members, new_cabinet, seed
from .test_tags_more import drag


def link(app, cid, folder):
    app.invoke("set_cabinet_folder", {"id": cid, "folder": str(folder)})


def cab_names(app, cid):
    return sorted(i["name"] for i in app.invoke("get_cabinet_items", {"cabinetId": cid, "includeVisuals": False}))


def cab_order(app):
    return [el.get_attribute("data-drop-item-cabinet-id") for el in app.page.locator("[data-drop-item-cabinet-id]").element_handles()]


@pytest.mark.case("E-CAB-04")
def test_fast_switch_no_stale_frame(app, sandbox):
    groups = {"柜甲": ["甲1.txt", "甲2.txt"], "柜乙": ["乙1.txt", "乙2.txt"], "柜丙": ["丙1.txt", "丙2.txt"]}
    seed(app, sandbox, [n for v in groups.values() for n in v])
    ids = {}
    for cab, names in groups.items():
        ids[cab] = new_cabinet(app, sandbox, cab)
        app.invoke("add_items_to_cabinet", {"cabinetId": ids[cab], "itemIds": [app.item(n)["id"] for n in names]})
    app.reload_page()
    app.sidebar_tab("文件柜")
    # 页面内逐帧记录可见名称（rAF），不截图
    app.page.evaluate("""() => {
      window.__frames = []; window.__rec = true;
      const tick = () => {
        const names = [...document.querySelectorAll('[data-selectable-item-id]')].map(e => (e.innerText||'').split('\\n')[0].trim());
        window.__frames.push(names);
        if (window.__rec) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }""")
    for cab in groups:
        cab_row(app, cab).click()
    app.wait_names(groups["柜丙"])
    app.page.wait_for_timeout(500)
    frames = app.page.evaluate("() => { window.__rec = false; return window.__frames; }")
    stale = set(groups["柜甲"] + groups["柜乙"])
    first_c = next(i for i, f in enumerate(frames) if set(f) == set(groups["柜丙"]))
    bad = [f for f in frames[first_c:] if set(f) & stale]
    assert not bad, f"出现丙柜内容后仍有旧柜帧：{bad[:3]}"
    assert frames[-1] and set(frames[-1]) == set(groups["柜丙"]), frames[-1]


@pytest.mark.case("E-CAB-06")
def test_linked_browse_and_flat(app, sandbox):
    folder = sandbox.files / "浏览夹"
    files.write(folder / "顶层.txt", "1")
    files.write(folder / "子目录" / "深处.txt", "2")
    cid = new_cabinet(app, sandbox, "浏览柜")
    link(app, cid, folder)
    wait_until(lambda: "深处.txt" in cab_names(app, cid), 15, lambda: cab_names(app, cid))
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "浏览柜").click()
    app.wait_names(["子目录", "顶层.txt"])
    nav = app.page.get_by_role("navigation", name="文件夹路径")
    app.card("子目录").dblclick()
    app.wait_names(["深处.txt"])
    assert nav.locator("[aria-current=page]").inner_text().strip() == "子目录"
    app.card("深处.txt").click()
    app.page.keyboard.press("Backspace")
    app.wait_names(["子目录", "顶层.txt"])
    assert nav.locator("[aria-current=page]").inner_text().strip() == "浏览柜"
    bar = app.page.locator("[data-region=linked-cabinet-bar]")
    bar.get_by_role("button", name="平铺显示").click()
    wait_until(lambda: {"顶层.txt", "深处.txt"} <= set(app.visible_names()), 8, app.visible_names)
    assert "平铺显示全部层级" in nav.inner_text()
    bar.get_by_role("button", name="按目录浏览").click()
    app.wait_names(["子目录", "顶层.txt"])


@pytest.mark.case("E-CAB-07")
def test_linked_follows_disk(app, sandbox):
    folder = sandbox.files / "同步夹"
    files.write(folder / "原有.txt", "1")
    cid = new_cabinet(app, sandbox, "跟随柜")
    link(app, cid, folder)
    wait_until(lambda: cab_names(app, cid) == ["原有.txt"], 15, lambda: cab_names(app, cid))
    files.write(folder / "新增.txt", "2")
    wait_until(lambda: cab_names(app, cid) == ["原有.txt", "新增.txt"], 20, lambda: cab_names(app, cid))
    (folder / "原有.txt").unlink()
    # 产品语义：磁盘删除 → 对象标为失效（柜栏给“清理失效（N）”），而不是静默删除
    def gone_or_missing():
        it = next((i for i in app.items() if i["name"] == "原有.txt"), None)
        return it is None or bool(it.get("is_missing"))
    wait_until(gone_or_missing, 20, lambda: [(i["name"], i.get("is_missing")) for i in app.items()])
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "跟随柜").click()
    bar = app.page.locator("[data-region=linked-cabinet-bar]")
    if "原有.txt" in cab_names(app, cid):
        bar.get_by_role("button", name="清理失效（1）").click()
        # 关联柜内的失效项走“不再追踪”文案（RemoveFromAppConfirmDialog）
        app.page.locator("[role=dialog][aria-modal=true]").get_by_role(
            "button", name=re.compile(r"^(从库中移除|不再追踪)$")).click()
        wait_until(lambda: cab_names(app, cid) == ["新增.txt"], 10, lambda: cab_names(app, cid))
    app.wait_names(["新增.txt"])


@pytest.mark.case("E-CAB-08")
def test_linked_folder_missing(app, sandbox):
    folder = sandbox.files / "将删夹"
    files.write(folder / "x.txt", "1")
    cid = new_cabinet(app, sandbox, "失联柜")
    link(app, cid, folder)
    wait_until(lambda: cab_names(app, cid) == ["x.txt"], 15)
    shutil.rmtree(folder)
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "失联柜").click()
    bar = app.page.locator("[data-region=linked-cabinet-bar]")
    bar.get_by_role("status").filter(has_text="关联文件夹不存在").wait_for(timeout=10000)


@pytest.mark.case("E-CAB-09")
def test_unlink_keeps_content(app, sandbox):
    folder = sandbox.files / "解除夹"
    files.write(folder / "留1.txt", "1")
    files.write(folder / "留2.txt", "2")
    cid = new_cabinet(app, sandbox, "解除柜")
    link(app, cid, folder)
    wait_until(lambda: cab_names(app, cid) == ["留1.txt", "留2.txt"], 15, lambda: cab_names(app, cid))
    app.reload_page()
    app.sidebar_tab("文件柜")
    cab_row(app, "解除柜").click(button="right")
    dlg = app.page.get_by_role("dialog", name="编辑文件柜")
    dlg.get_by_role("button", name="解除关联").click()
    dlg.get_by_text("未关联").wait_for()
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT folder_path FROM cabinets WHERE id=?", (cid,)) is None, 5)
    assert members(sandbox, cid) == ["留1.txt", "留2.txt"]
    # 普通柜：磁盘新增不再自动进柜
    files.write(folder / "后来.txt", "3")
    app.page.wait_for_timeout(3000)
    assert "后来.txt" not in cab_names(app, cid)
    cab_row(app, "解除柜").click()
    app.wait_names(["留1.txt", "留2.txt"])
    assert app.page.locator("[data-region=linked-cabinet-bar]").count() == 0


@pytest.mark.case("E-CAB-10")
def test_linked_truncated_over_50000(app, sandbox):
    folder = sandbox.files / "超大夹"
    for d in range(51):
        sub = folder / f"d{d:02d}"
        sub.mkdir(parents=True, exist_ok=True)
        for i in range(1000):
            with open(os.path.join(sub, f"f{i:04d}.txt"), "wb"):
                pass
    cid = new_cabinet(app, sandbox, "超大柜")
    link(app, cid, folder)
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT folder_truncated FROM cabinets WHERE id=?", (cid,)) == 1,
               600, lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items"))
    app.reload_page()
    app.sidebar_tab("文件柜")
    assert cab_row(app, "超大柜").locator('[title*="只同步了一部分"]').count() == 1
    cab_row(app, "超大柜").click()
    app.page.locator("[data-region=linked-cabinet-bar]").get_by_role("status").filter(
        has_text="只同步了一部分").wait_for(timeout=30000)


@pytest.mark.case("E-CAB-11")
def test_cabinet_reorder_persists(app, sandbox):
    a = new_cabinet(app, sandbox, "第一柜")
    b = new_cabinet(app, sandbox, "第二柜")
    c = new_cabinet(app, sandbox, "第三柜")
    app.reload_page()
    app.sidebar_tab("文件柜")
    want0 = [str(a), str(b), str(c)]
    wait_until(lambda: cab_order(app) == want0, 5, lambda: cab_order(app))
    drag(app, cab_row(app, "第一柜"), cab_row(app, "第三柜"), after=True)
    want = [str(b), str(c), str(a)]
    wait_until(lambda: cab_order(app) == want, 5, lambda: cab_order(app))
    app.restart()
    app.sidebar_tab("文件柜")
    wait_until(lambda: cab_order(app) == want, 15, lambda: cab_order(app))
