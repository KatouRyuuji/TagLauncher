"""F19 探针：列表下方空白区域偶发跑到顶部（用户反馈，尚未稳定复现）。

在 CI 真实 WebView2 中走用户可能的路径：长列表滚到底 → 搜索缩成短列表 → 切行密度 →
清空搜索/切视图再回来。每一步断言首行相对列表顶部的偏移与初始一致、可见行首尾相接，
即顶部没有凭空出现空白。通过只说明这些路径不触发，不代表 F19 已修。
"""
from __future__ import annotations

import pytest

from harness import files
from harness.app import wait_until

GEOMETRY_JS = """() => {
  const list = document.querySelector('[role="list"][aria-label="项目列表"]');
  if (!list) return null;
  let sc = list;
  while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  const rows = [...list.querySelectorAll('[data-selectable-item-id]')]
    .map((r) => r.getBoundingClientRect()).filter((b) => b.height > 0).sort((a, b) => a.top - b.top);
  const viewTop = sc ? sc.getBoundingClientRect().top : list.getBoundingClientRect().top;
  return {
    n: rows.length,
    firstOffset: rows.length ? Math.round(rows[0].top - list.getBoundingClientRect().top) : null,
    firstFromViewport: rows.length ? Math.round(rows[0].top - viewTop) : null,
    maxGap: rows.slice(1).reduce((m, b, i) => Math.max(m, Math.round(b.top - rows[i].bottom)), 0),
    scrollTop: sc ? Math.round(sc.scrollTop) : 0,
  };
}"""

SCROLL_BOTTOM_JS = """() => {
  const list = document.querySelector('[role="list"][aria-label="项目列表"]');
  let sc = list;
  while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  if (sc) sc.scrollTop = sc.scrollHeight;
  return sc ? sc.scrollTop : -1;
}"""


@pytest.mark.case("F19")
def test_list_top_has_no_blank_after_shrink(app, sandbox):
    long = [files.write(sandbox.files / "f19" / f"长条目{i:03d}.txt", str(i)) for i in range(80)]
    short = [files.write(sandbox.files / "f19" / f"短条目{i}.txt", "s") for i in range(3)]
    app.seed(long + short)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    geo = lambda: app.page.evaluate(GEOMETRY_JS)
    wait_until(lambda: (g := geo()) and g["n"] > 5, 8, geo)
    base = geo()

    def assert_top_flush(step: str, rows: int | None = None):
        def ok():
            g = geo()
            return g and (rows is None or g["n"] == rows) and abs(g["firstOffset"] - base["firstOffset"]) <= 2 \
                and g["maxGap"] <= 2 and g["firstFromViewport"] <= base["firstFromViewport"] + 2
        wait_until(ok, 5, lambda: f"{step}: 基线 {base}，实际 {geo()}")

    assert app.page.evaluate(SCROLL_BOTTOM_JS) > 0, "长列表应可滚动"
    app.page.wait_for_timeout(300)
    app.search("短条目")
    assert_top_flush("长列表滚到底后搜索缩成 3 行", rows=3)
    for density in ("紧凑", "舒适"):
        app.page.get_by_role("button", name=density, exact=True).click()
        assert_top_flush(f"短列表切到{density}", rows=3)
    app.search("")
    wait_until(lambda: geo()["n"] > 5, 5, geo)
    app.page.evaluate(SCROLL_BOTTOM_JS)
    app.page.get_by_role("button", name="紧凑", exact=True).click()
    app.search("短条目")
    assert_top_flush("紧凑+滚到底后再缩短", rows=3)
    app.page.get_by_role("button", name="网格视图", exact=True).click()
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    assert_top_flush("切网格再回列表", rows=3)
