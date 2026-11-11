"""F04c：标签过滤先在「当前层 + 下级」里找，找不到提示转全局（E-TAG-F04C-*）。

当前层 = 侧栏已选的正向标签。侧栏「过滤标签…」与对象「管理标签」弹窗同一口径。
"""
from __future__ import annotations

import pytest

from harness.app import wait_until

from .test_tags import seed_files, setup_tags

NAMES = ["游戏", "动作", "动作射击", "影视", "动作片", "工具", "办公", "音乐", "摇滚", "收藏", "临时"]
EDGES = [("游戏", "动作"), ("动作", "动作射击"), ("影视", "动作片"), ("音乐", "摇滚"), ("游戏", "收藏"), ("影视", "收藏")]


def sidebar_names(app) -> list[str]:
    return [t.split("\n")[0].strip() for t in app.page.locator("[data-tag-row-id]").all_inner_texts()]


@pytest.mark.case("E-TAG-F04C-01")
def test_tag_filter_searches_current_subtree_then_offers_global(app, sandbox):
    seed_files(app, sandbox, ["范围.txt"])
    setup_tags(app, NAMES)
    ids = app.tag_ids()
    for p, c in EDGES:
        app.invoke("add_tag_relation", {"parentId": ids[p], "childId": ids[c]})
    app.reload_page()
    app.page.locator(f'[data-tag-row-id="{ids["游戏"]}"]').first.click()
    box = app.page.get_by_label("过滤标签")
    assert "「游戏」及下级" in (box.get_attribute("placeholder") or "")

    box.fill("动作")
    notice = app.page.get_by_test_id("tag-scope-notice")
    wait_until(lambda: sorted(sidebar_names(app)) == ["动作", "动作射击"], 5, lambda: sidebar_names(app))
    assert notice.get_attribute("data-scope") == "subtree"
    assert "全部 3 个" in notice.inner_text()
    notice.get_by_role("button", name="查看全部").click()
    wait_until(lambda: sorted(sidebar_names(app)) == ["动作", "动作射击", "动作片"], 5, lambda: sidebar_names(app))
    assert notice.get_attribute("data-scope") == "global"
    notice.get_by_role("button", name="只看「游戏」及下级").click()
    wait_until(lambda: sorted(sidebar_names(app)) == ["动作", "动作射击"], 5, lambda: sidebar_names(app))

    # 当前层没有命中：提示全局命中数，Enter 转全局
    box.fill("工具")
    wait_until(lambda: "全部标签中有 1 个" in notice.inner_text(), 5, lambda: notice.inner_text())
    assert sidebar_names(app) == []
    box.press("Enter")
    wait_until(lambda: sidebar_names(app) == ["工具"], 5, lambda: sidebar_names(app))

    # 多父共享子「收藏」：只列当前层那条路径
    box.fill("收藏")
    wait_until(lambda: app.page.locator(f'[data-tag-row-id="{ids["收藏"]}"]').count() == 1, 5)
    assert app.page.locator(f'[data-tag-row-id="{ids["收藏"]}"]').get_attribute("data-tag-parent-id") == str(ids["游戏"])

    # 对象「管理标签」弹窗：同一当前层与提示
    box.fill("")
    app.menu_click("范围.txt", "管理标签")
    dlg = app.dialog("管理项目标签")
    dlg.locator('input[type="search"]').fill("工具")
    dn = dlg.get_by_test_id("tag-scope-notice")
    wait_until(lambda: "全部标签中有 1 个" in dn.inner_text(), 5, lambda: dn.inner_text())
    dlg.locator('input[type="search"]').press("Enter")
    dlg.get_by_role("button", name="工具", exact=True).wait_for(timeout=3000)
    dlg.press("Escape")  # 先清过滤词
    dlg.press("Escape")
    dlg.wait_for(state="hidden")
