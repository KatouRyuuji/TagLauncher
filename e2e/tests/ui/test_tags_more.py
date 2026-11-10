"""标签补充用例（E-TAG-03/08/10/12/13/14/15/16）。"""
from __future__ import annotations

import re

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

from .test_tags import item_tag_names, seed_files, setup_tags, tag_editor
from .test_theme import FAMILIES, current_theme_id


def tag_order(app):
    return [app.page.evaluate("(e) => e.innerText", el).split("\n")[0].strip()
            for el in app.page.locator("[data-tag-row-id]").element_handles()]


def drag(app, src, dst, after=True):
    s, d = src.bounding_box(), dst.bounding_box()
    m = app.page.mouse  # CDP 合成指针事件，不动系统鼠标
    m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
    m.down()
    m.move(s["x"] + s["width"] / 2 + 4, s["y"] + s["height"] / 2 + 8, steps=4)
    y = d["y"] + d["height"] * (0.8 if after else 0.2)
    m.move(d["x"] + d["width"] / 2, y, steps=15)
    m.move(d["x"] + d["width"] / 2 + 1, y, steps=2)
    m.up()


@pytest.mark.case("E-TAG-03")
def test_case_insensitive_reuse_in_item_dialog(app, sandbox):
    seed_files(app, sandbox, ["大小写.txt"])
    setup_tags(app, ["Game"])
    app.menu_click("大小写.txt", "管理标签")
    dlg = app.dialog("管理项目标签")
    dlg.get_by_label("新标签名称").fill("game")
    dlg.get_by_role("button", name="创建").click()
    dlg.get_by_role("button", name="移除已选标签「Game」").wait_for()
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    iid = app.item("大小写.txt")["id"]
    wait_until(lambda: item_tag_names(sandbox, iid) == ["Game"], 5, lambda: item_tag_names(sandbox, iid))
    assert dbh.query(sandbox.db_path, "SELECT name FROM tags") == [("Game",)]


@pytest.mark.case("E-TAG-03")
# BUG-15 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_case_insensitive_reuse_in_sidebar(app, sandbox):
    setup_tags(app, ["Game"])
    app.page.get_by_role("button", name="新建标签").click()
    dlg = tag_editor(app, "新建标签")
    dlg.get_by_placeholder("标签名称").fill("game")
    dlg.get_by_role("button", name="保存").click()
    app.page.wait_for_timeout(800)
    names = [r[0] for r in dbh.query(sandbox.db_path, "SELECT name FROM tags")]
    assert names == ["Game"], names


@pytest.mark.case("E-TAG-08")
def test_alt_click_exclude(app, sandbox):
    seed_files(app, sandbox, ["保留.txt", "排除.txt"])
    t = app.add_tag("排")
    app.invoke("set_item_tags", {"itemId": app.item("排除.txt")["id"], "tagIds": [t]})
    app.reload_page()
    app.sidebar_tag("排").click(modifiers=["Alt"])
    app.page.locator(f'[data-tag-row-id="{t}"][aria-label="排（已排除）"]').wait_for()
    app.wait_names(["保留.txt"])
    app.page.locator(f'[data-tag-row-id="{t}"]').click(modifiers=["Alt"])
    app.wait_names(["保留.txt", "排除.txt"])
    # 普通选中后在筛选条右键改为排除
    app.sidebar_tag("排").click()
    app.wait_names(["排除.txt"])
    chip = app.page.get_by_title("排（点击取消筛选，右键改为排除）")
    chip.click(button="right")
    app.page.get_by_label("排（已排除）").first.wait_for()
    app.wait_names(["保留.txt"])


@pytest.mark.case("E-TAG-10")
def test_cycle_rejected(app, sandbox):
    p = app.add_tag("祖")
    c = app.add_tag("孙")
    app.invoke("add_tag_relation", {"parentId": p, "childId": c})
    app.reload_page()
    app.page.get_by_role("button", name="管理标签父子关系").click()
    dlg = app.dialog("标签关系")
    dlg.get_by_role("button", name="祖", exact=True).first.click()
    # 祖 的候选父标签里不能出现其后代 孙
    assert dlg.get_by_role("button", name=re.compile(r"^孙\s*＋$")).count() == 0
    err = app.invoke_error("add_tag_relation", {"parentId": c, "childId": p})
    assert err and "循环" in err, err
    err = app.invoke_error("add_tag_relation", {"parentId": p, "childId": p})
    assert err and "自己" in err, err
    assert dbh.query(sandbox.db_path, "SELECT parent_id, child_id FROM tag_relations") == [(p, c)]


@pytest.mark.case("E-TAG-12")
def test_tag_graph(app, sandbox):
    seed_files(app, sandbox, ["图父.txt", "图子.txt", "图外.txt"])
    p = app.add_tag("图谱父")
    c = app.add_tag("图谱子")
    app.invoke("add_tag_relation", {"parentId": p, "childId": c})
    gc = app.add_tag("图谱孙")
    app.invoke("add_tag_relation", {"parentId": c, "childId": gc})
    app.invoke("set_item_tags", {"itemId": app.item("图父.txt")["id"], "tagIds": [p]})
    app.invoke("set_item_tags", {"itemId": app.item("图子.txt")["id"], "tagIds": [c]})
    app.reload_page()
    # 入口一：侧栏按钮
    app.page.get_by_role("button", name="打开标签关系图").click()
    g = app.page.get_by_role("dialog", name="标签关系图")
    g.wait_for()
    g.locator(f'[data-graph-node-id="{c}"]').click()
    det = g.get_by_label("标签详情", exact=True)
    det.wait_for()
    assert "父：" in det.inner_text() and "图谱父" in det.inner_text()
    g.locator(f'[data-graph-node-id="{p}"]').click()
    assert "子：" in det.inner_text() and "图谱子" in det.inner_text()
    # F06：选中父标签时孙标签也高亮（后代闭包），详情给出后代数
    assert g.locator(f'[data-graph-node-id="{gc}"]').get_attribute("data-graph-relation") == "descendant"
    assert g.locator(f'[data-graph-node-id="{c}"]').get_attribute("data-graph-relation") == "child"
    assert "共 2 个后代标签" in det.inner_text()
    g.get_by_role("button", name="关闭层级图谱").click()
    g.wait_for(state="hidden")
    # 入口二：命令面板；双击节点直接筛选并回到工作台
    app.run_command("打开标签图谱")
    g.wait_for()
    g.locator(f'[data-graph-node-id="{p}"]').dblclick()
    g.wait_for(state="hidden")
    app.wait_names(["图父.txt", "图子.txt"])
    assert app.page.locator(f'[data-tag-row-id="{p}"]').get_attribute("aria-pressed") == "true"


@pytest.mark.case("E-TAG-13")
def test_tag_graph_empty(app, sandbox):
    app.run_command("打开标签图谱")
    g = app.page.get_by_role("dialog", name="标签关系图")
    g.get_by_text("还没有标签").wait_for()
    g.get_by_role("button", name="返回工作台创建标签").click()
    g.wait_for(state="hidden")


@pytest.mark.case("E-TAG-14")
def test_sidebar_tag_reorder_persists(app, sandbox):
    setup_tags(app, ["一号", "二号", "三号"])
    assert tag_order(app) == ["一号", "二号", "三号"], tag_order(app)
    drag(app, app.sidebar_tag("一号"), app.sidebar_tag("三号"), after=True)
    wait_until(lambda: tag_order(app) == ["二号", "三号", "一号"], 5, lambda: tag_order(app))
    app.restart()
    wait_until(lambda: tag_order(app) == ["二号", "三号", "一号"], 15, lambda: tag_order(app))


@pytest.mark.case("E-TAG-15")
def test_sidebar_tag_filter(app, sandbox):
    names = ["工作", "学习", "游戏", "音乐", "电影", "照片", "文档", "代码", "设计", "旅行"]
    setup_tags(app, names)
    box = app.page.get_by_label("过滤标签")
    box.fill("工")
    wait_until(lambda: tag_order(app) == ["工作"], 5, lambda: tag_order(app))
    box.fill("")
    wait_until(lambda: len(tag_order(app)) == 10, 5, lambda: tag_order(app))


@pytest.mark.case("E-TAG-15")
# BUG-16 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_sidebar_tag_filter_pinyin(app, sandbox):
    names = ["工作", "学习", "游戏", "音乐", "电影", "照片", "文档", "代码", "设计", "旅行"]
    setup_tags(app, names)
    app.page.get_by_label("过滤标签").fill("gz")
    wait_until(lambda: tag_order(app) == ["工作"], 3, lambda: tag_order(app))


@pytest.mark.case("E-TAG-16")
def test_recolor_on_family_switch(app, sandbox):
    app.page.get_by_role("button", name="新建标签").click()
    dlg = tag_editor(app, "新建标签")
    dlg.get_by_placeholder("标签名称").fill("换色")
    dlg.get_by_role("radiogroup", name="分类颜色").get_by_role("radio").nth(2).click()
    dlg.get_by_role("button", name="保存").click()
    dlg.wait_for(state="hidden")
    tid = app.tag_ids()["换色"]
    color = lambda: dbh.scalar(sandbox.db_path, "SELECT color FROM tags WHERE id=?", (tid,)).lower()
    palette = lambda: [c.strip().lower() for c in app.page.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--tag-preset-colors')").split(",") if c.strip()]
    wait_until(lambda: color() in palette(), 5, lambda: (color(), palette()))
    slot = palette().index(color())
    cur = current_theme_id(app)
    target = next(n for n, ids in FAMILIES.items() if cur not in ids and n != "素墨")
    sdlg = app.open_settings("主题外观")
    sdlg.get_by_role("radiogroup", name="官方配色").get_by_role("radio", name=target).click()
    wait_until(lambda: current_theme_id(app) in FAMILIES[target], 5)
    wait_until(lambda: palette() and color() == palette()[slot], 8, lambda: (color(), palette()))
