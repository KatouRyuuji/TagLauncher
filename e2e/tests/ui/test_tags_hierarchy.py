"""F14：侧栏「编辑层级」拖动改父子关系（E-TAG-F14-*）。

语义（与侧栏多父展示 F12 一致，按路径行操作）：
- 拖到标签上 = 加为它的下级，保留原父级（多父）；
- 按住 Alt 放下 = 从这一行所在的父级移过去（换边）；
- 拖到顶部虚线框 = 移出这一行所在的父级；
- 防环：拖到自己的后代上被拒绝，关系不变；
- 退出编辑层级后，拖动恢复为同级排序，不改关系。
"""
from __future__ import annotations

import pytest

from harness import db as dbh
from harness.app import wait_until

from .test_tags import setup_tags


def edges(sandbox) -> list[tuple[int, int]]:
    return sorted(dbh.query(sandbox.db_path, "SELECT parent_id, child_id FROM tag_relations"))


def row(app, tag_id: int, parent_id: int | None):
    return app.page.locator(f'[data-tag-row-id="{tag_id}"][data-tag-parent-id="{"" if parent_id is None else parent_id}"]')


def drag_to(app, src, dst, alt: bool = False) -> None:
    s, d = src.bounding_box(), dst.bounding_box()
    m = app.page.mouse  # CDP 合成指针事件，不动系统鼠标
    m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
    m.down()
    m.move(s["x"] + s["width"] / 2 + 4, s["y"] + s["height"] / 2 + 8, steps=4)
    if alt:
        app.page.keyboard.down("Alt")
    x, y = d["x"] + d["width"] / 2, d["y"] + d["height"] / 2
    m.move(x, y, steps=15)
    m.move(x + 1, y, steps=2)
    m.up()
    if alt:
        app.page.keyboard.up("Alt")


def wait_edges(sandbox, want) -> None:
    want = sorted(want)
    wait_until(lambda: edges(sandbox) == want, 5, lambda: f"期望 {want}，实际 {edges(sandbox)}")


@pytest.mark.case("E-TAG-F14-01")
def test_drag_edits_hierarchy_add_move_detach_and_rejects_cycles(app, sandbox):
    setup_tags(app, ["甲", "乙", "丙", "丁"])
    ids = app.tag_ids()
    A, B, C, D = ids["甲"], ids["乙"], ids["丙"], ids["丁"]
    toggle = app.page.get_by_test_id("tag-hierarchy-edit")
    toggle.click()
    assert toggle.get_attribute("aria-pressed") == "true"

    # 加边：丙 → 甲 下；丁 → 甲/丙 下
    drag_to(app, row(app, C, None), row(app, A, None))
    wait_edges(sandbox, [(A, C)])
    row(app, C, A).wait_for(timeout=5000)
    app.page.get_by_text("已把「丙」放到「甲」下（保留原来的上级）").first.wait_for(timeout=3000)
    drag_to(app, row(app, D, None), row(app, C, A))
    wait_edges(sandbox, [(A, C), (C, D)])

    # 防环：甲拖到它的后代丁上 → 拒绝，关系不变
    drag_to(app, row(app, A, None), row(app, D, C))
    app.page.get_by_text("无法调整层级：目标是它的下级标签，会形成循环").first.wait_for(timeout=3000)
    assert edges(sandbox) == sorted([(A, C), (C, D)])

    # 多父：甲下的丙拖到乙上 = 加边；侧栏在两个父级下都显示丙（及其下级丁）
    drag_to(app, row(app, C, A), row(app, B, None))
    wait_edges(sandbox, [(A, C), (B, C), (C, D)])
    row(app, C, A).wait_for(timeout=5000)
    row(app, C, B).wait_for(timeout=5000)
    wait_until(lambda: row(app, D, C).count() == 2, 5, lambda: f"丁应在两条路径下各出现一次：{row(app, D, C).count()}")

    # 已是下级：再拖一次不变
    drag_to(app, row(app, C, A), row(app, B, None))
    app.page.get_by_text("无法调整层级：已是它的下级标签").first.wait_for(timeout=3000)

    # Alt 换边：丙下的丁（第一条路径）按住 Alt 拖到乙 → 删 丙→丁、加 乙→丁
    drag_to(app, row(app, D, C).first, row(app, B, None), alt=True)
    wait_edges(sandbox, [(A, C), (B, C), (B, D)])

    # 移到顶层：只删这一行所在的父边（甲→丙），丙仍在乙下
    drag_to(app, row(app, C, A), app.page.get_by_test_id("tag-root-drop"))
    wait_edges(sandbox, [(B, C), (B, D)])
    wait_until(lambda: row(app, C, A).count() == 0 and row(app, C, B).count() == 1, 5)

    # 退出编辑层级：跨父拖动不改关系（恢复排序手势）
    toggle.click()
    assert toggle.get_attribute("aria-pressed") == "false"
    drag_to(app, row(app, A, None), row(app, C, B))
    app.page.wait_for_timeout(600)
    assert edges(sandbox) == sorted([(B, C), (B, D)])
