"""视图、选择与批量（E-VIEW-*）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def seed_n(app, sandbox, n, sub="v"):
    paths = [files.write(sandbox.files / sub / f"对象{i:02d}.txt", str(i)) for i in range(n)]
    app.seed(paths)
    return paths


def toolbar_count(app) -> str:
    return app.get_toolbar().inner_text()


@pytest.mark.case("E-VIEW-01")
def test_view_modes_persist(app, sandbox):
    seed_n(app, sandbox, 3)
    for label in ("列表视图", "大图标视图", "网格视图", "列表视图"):
        btn = app.page.get_by_role("button", name=label, exact=True)
        btn.click()
        wait_until(lambda: btn.get_attribute("aria-pressed") == "true", 3)
        app.wait_count(3)
    app.restart()
    btn = app.page.get_by_role("button", name="列表视图", exact=True)
    wait_until(lambda: btn.get_attribute("aria-pressed") == "true", 10)
    assert app.js_errors() == []


@pytest.mark.case("E-VIEW-06")
def test_click_ctrl_shift_selection(app, sandbox):
    seed_n(app, sandbox, 6)
    names = app.visible_names()
    ids = {i["name"]: i["id"] for i in app.items()}
    app.card(names[0]).click()
    assert app.selected_ids() == [ids[names[0]]]
    app.card(names[2]).click(modifiers=["Control"])
    assert sorted(app.selected_ids()) == sorted([ids[names[0]], ids[names[2]]])
    app.card(names[4]).click(modifiers=["Shift"])
    sel = set(app.selected_ids())
    assert {ids[names[2]], ids[names[3]], ids[names[4]]} <= sel
    assert "已选中" in toolbar_count(app)
    assert str(len(sel)) in toolbar_count(app)


@pytest.mark.case("E-VIEW-07")
def test_marquee_select_and_alt_subtract(app, sandbox):
    # 6 行：CI 屏幕把窗口夹到 ~720px 高，8 行（舒适 64px）会占满列表区，末行下方没有空白可起拖
    seed_n(app, sandbox, 6)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    names = app.visible_names()
    assert len(names) == 6, names
    ids = {i["name"]: i["id"] for i in app.items()}
    last = app.card(names[-1]).bounding_box()
    m = app.page.mouse
    # 列表行占满整宽，起点在行上会变成拖拽卡片；框选须从列表下方空白处起拖（向上覆盖后三行）
    x0 = last["x"] + last["width"] / 2
    y0 = last["y"] + last["height"] + 25
    target = app.card(names[3]).bounding_box()
    status = app.page.get_by_role("button", name="紧凑", exact=True).bounding_box()
    assert y0 < status["y"] - 4, ("末行下方无空白可起拖", last, status)
    m.move(x0, y0)
    m.down()
    m.move(x0 - 40, target["y"] + target["height"] / 2, steps=12)
    m.up()
    got = set(app.selected_ids())
    assert {ids[n] for n in names[3:]} <= got and ids[names[2]] not in got, (got, names[3:])
    # Alt+框选：从已选集合中减去（只覆盖最后一行）
    # 选中后底部浮出批量工具条，会盖住原起点：Alt 框选从末行与工具条之间的空隙起拖
    tbar = app.get_toolbar().bounding_box()
    gap_top, gap_bot = last["y"] + last["height"], tbar["y"]
    assert gap_bot - gap_top >= 6, ("末行与批量工具条之间无空白可起拖", last, tbar)
    y0 = (gap_top + gap_bot) / 2
    app.page.keyboard.down("Alt")
    m.move(x0, y0)
    m.down()
    m.move(x0 - 40, last["y"] + last["height"] / 2, steps=8)
    m.up()
    app.page.keyboard.up("Alt")
    got2 = set(app.selected_ids())
    assert ids[names[5]] not in got2 and {ids[names[3]], ids[names[4]]} <= got2, (got2, names)


@pytest.mark.case("E-VIEW-08")
def test_ctrl_a_selects_unrendered(sandbox, app_factory):
    dbh.bulk_items(sandbox.db_path, 5000, root=str(sandbox.files / "不存在"))
    app = app_factory()
    app.wait_count(5000, timeout=30)
    app.page.locator("[data-selectable-item-id]").first.click()
    app.page.keyboard.press("Control+a")
    # 只有已渲染的卡片在 DOM 里，选中总数以批量工具条计数为准
    wait_until(lambda: "5000" in toolbar_count(app).replace(",", ""), 8, lambda: toolbar_count(app))
    rendered = app.page.locator("[data-selectable-item-id]").count()
    assert rendered < 5000


@pytest.mark.case("E-VIEW-09")
def test_batch_toolbar_actions(app, sandbox):
    paths = seed_n(app, sandbox, 3)
    names = app.visible_names()
    app.card(names[0]).click()
    app.card(names[1]).click(modifiers=["Control"])
    bar = app.get_toolbar()
    app.page.keyboard.press("Control+d")
    wait_until(lambda: sum(1 for i in app.items() if i["is_favorite"]) == 2, 5)
    bar.get_by_role("button", name="复制路径").click()
    app.wait_toast("已复制 2 条路径")
    assert app.clipboard()[-1].splitlines() == [app.item(names[0])["path"], app.item(names[1])["path"]] or \
        sorted(app.clipboard()[-1].splitlines()) == sorted([app.item(names[0])["path"], app.item(names[1])["path"]])
    bar.get_by_role("button", name="取消选择").click()
    assert app.selected_ids() == []
    bar.wait_for(state="hidden")


@pytest.mark.case("E-VIEW-10")
def test_virtualization_50k(sandbox, app_factory):
    dbh.bulk_items(sandbox.db_path, 50000, root=str(sandbox.files / "不存在"))
    t0 = time.monotonic()
    app = app_factory(start=False).start(timeout=240)
    app.wait_count(50000, timeout=120)
    startup = time.monotonic() - t0
    (sandbox.artifacts / "view-10-startup.txt").write_text(f"{startup:.1f}s", encoding="utf-8")
    print(f"VIEW-10 startup {startup:.1f}s")
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    # 点名称：行中心在窄窗口落在「+ 添加标签」上
    app.page.locator("[data-selectable-item-id]").first.get_by_role("heading", level=3).click()
    app.page.keyboard.press("End")
    first_id = app.selected_ids()
    wait_until(lambda: app.selected_ids() and app.selected_ids() != first_id, 10)
    sel = app.selected_ids()[0]
    card = app.card_by_id(sel)
    card.wait_for(timeout=10_000)
    # 可见＝落在列表滚动容器的可视区内（用户看到的范围）；失败时带出几何数据便于分诊
    geo_js = """el => { const r = el.getBoundingClientRect();
      let sc = el.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vTop: Math.round(v.top), vBottom: Math.round(v.bottom),
               innerHeight, scrollTop: sc ? Math.round(sc.scrollTop) : null, ok: r.height > 0 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1 }; }"""
    wait_until(lambda: card.evaluate(geo_js)["ok"], 10, lambda: card.evaluate(geo_js))
    # End 后应在最末项：继续 End/ArrowDown 不再改变选中
    app.page.keyboard.press("ArrowDown")
    assert app.selected_ids() == [sel]
    nodes = app.page.locator("[data-selectable-item-id]").count()
    assert nodes < 600, nodes
    assert app.js_errors() == []
