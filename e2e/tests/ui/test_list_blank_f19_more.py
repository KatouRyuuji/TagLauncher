"""F19 复现矩阵：列表底部空白跑到顶部（用户：可能与增删对象、拖动/改窗口尺寸、切换筛选有关）。

在真实 WebView2 里按交错序列操作，每步后检查「视口无空带」不变量：
滚动容器可视区（列表视图扣掉吸顶表头）里，从列表内容起点到内容终点之间，已渲染的行（含分页占位行）
必须连续覆盖，不允许出现高于 4px 的空带；同时记录 scrollTop / scrollHeight / 列表总高 / 首个渲染行下标，
失败信息即复现步骤与现场数据。所有步骤跑完再统一断言，一次拿到全部违例。
窗口尺寸用 CDP Emulation 改视口（与拖动窗口边框对前端的影响相同：resize + ResizeObserver），
增删对象走外部 tl（data-changed External → 重载），与用户在别处增删一致。
"""
from __future__ import annotations

import json

import pytest

from harness import files
from harness.app import wait_until
from tests.cli.conftest import Tl

PROBE_JS = """(mode) => {
  const lists = [...document.querySelectorAll('[role="list"][aria-label="项目列表"]')];
  const list = lists.find((l) => l.offsetParent !== null) || lists[0];
  if (!list) return null;
  let sc = list.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  if (!sc) return null;
  const scr = sc.getBoundingClientRect();
  const sticky = [...sc.querySelectorAll('.sticky')].find((e) => e.getBoundingClientRect().height > 0 && sc.contains(e));
  const headerH = sticky ? sticky.getBoundingClientRect().height : 0;
  const L = list.getBoundingClientRect();
  // 虚拟行带 data-index；网格「≤3 项」不虚拟化，按卡片算
  let kids = [...list.children].filter((c) => c.hasAttribute('data-index'));
  const few = kids.length === 0;
  if (few) kids = [...list.querySelectorAll('.item-grid-few-card')];
  const rows = kids
    .map((c, k) => ({ i: few ? k : Number(c.dataset.index), r: c.getBoundingClientRect(), ph: !c.querySelector('[data-selectable-item-id]') }))
    .filter((x) => x.r.height > 0).sort((a, b) => a.r.top - b.r.top);
  const contentEnd = rows.length ? Math.max(...rows.map((x) => x.r.bottom)) : L.top;
  const lastIndex = rows.length ? Math.max(...rows.map((x) => x.i)) : -1;
  const viewTop = Math.max(scr.top + headerH, L.top);
  const viewBottom = Math.min(scr.bottom, L.bottom);
  // 期望被行覆盖的区间：可视区 ∩ [列表顶, 最后一行底]（最后一行之后的「底部空」是正常的）
  const want = [viewTop, Math.min(viewBottom, contentEnd)];
  let cursor = want[0], maxGap = 0, gapAt = null;
  for (const x of rows) {
    if (x.r.bottom <= cursor) continue;
    if (x.r.top > cursor) { const g = Math.min(x.r.top, want[1]) - cursor; if (g > maxGap) { maxGap = g; gapAt = Math.round(cursor - scr.top); } }
    cursor = Math.max(cursor, x.r.bottom);
    if (cursor >= want[1]) break;
  }
  if (cursor < want[1] && want[1] - cursor > maxGap) { maxGap = want[1] - cursor; gapAt = Math.round(cursor - scr.top); }
  const stats = (window.__tlMainPerf && window.__tlMainPerf.stats) || {};
  const vd = (stats.gridVirtual && list.dataset.region === 'item-grid-inner' && !few) ? stats.gridVirtual()
    : (stats.listVirtual && list.dataset.region !== 'item-grid-inner' && !few) ? stats.listVirtual() : null;
  // 虚拟器缓存尺寸与 DOM 实测不一致的已渲染行（>1px）：空带/重叠的直接证据
  const mismatch = vd ? vd.items.filter((x) => x.dom != null && x.cached != null && Math.abs(x.cached - x.dom) > 1) : [];
  return {
    mode, few, rows: rows.length, mismatch: mismatch.slice(0, 6), virt: vd && {
      count: vd.count, scrollOffset: vd.scrollOffset, scrollTop: vd.scrollTop, isScrolling: vd.isScrolling, totalSize: vd.totalSize,
      unobserved: vd.items.filter((x) => x.dom != null && !x.observed).map((x) => x.i).slice(0, 10),
      items: vd.items.slice(0, 8),
    }, placeholders: rows.filter((x) => x.ph).length,
    firstIndex: rows.length ? rows[0].i : null, lastIndex,
    maxGap: Math.round(maxGap), gapAtFromViewportTop: gapAt,
    scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight,
    listHeight: Math.round(L.height), headerH: Math.round(headerH),
    rendered: rows.slice(0, 4).map((x) => [x.i, Math.round(x.r.top - scr.top), Math.round(x.r.height)]),
  };
}"""

SCROLL_JS = """(frac) => {
  const lists = [...document.querySelectorAll('[role="list"][aria-label="项目列表"]')];
  const list = lists.find((l) => l.offsetParent !== null) || lists[0];
  let sc = list && list.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  if (!sc) return -1;
  sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * frac);
  return sc.scrollTop;
}"""

# 持续滚动（模拟滚轮/拖滚动条）：rAF 里每帧 +step，持续 ms 毫秒
SCROLLING_JS = """([step, ms]) => {
  const lists = [...document.querySelectorAll('[role="list"][aria-label="项目列表"]')];
  const list = lists.find((l) => l.offsetParent !== null) || lists[0];
  let sc = list && list.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  if (!sc) return;
  const end = performance.now() + ms;
  const tick = () => { sc.scrollTop += step; if (performance.now() < end) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}"""

GAP_PX = 4


class Probe:
    def __init__(self, app):
        self.app = app
        self.log: list[dict] = []
        self.bad: list[dict] = []

    def check(self, step: str, settle_ms: int = 400) -> dict:
        page = self.app.page
        page.wait_for_timeout(settle_ms)
        g = page.evaluate(PROBE_JS, step)
        # 给分页取数一点时间：占位行允许存在，但空带不允许；稳定后再判
        if g and g["maxGap"] > GAP_PX:
            page.wait_for_timeout(800)
            g = page.evaluate(PROBE_JS, step)
            if g and g["maxGap"] > GAP_PX:
                # 是否长期存在：再等 3 秒（无任何操作）看是否自行收敛
                page.wait_for_timeout(3000)
                later = page.evaluate(PROBE_JS, step)
                g["after3s"] = later and {k: later.get(k) for k in ("maxGap", "mismatch", "scrollTop")}
        self.log.append(g)
        print(f"F19_STEP {json.dumps(g, ensure_ascii=False)}")
        if g is None or g["maxGap"] > GAP_PX:
            self.bad.append(g or {"mode": step, "missing": True})
        return g


def view(app, name: str) -> None:
    app.page.get_by_role("button", name=name, exact=True).click()


def resize(app, w: int, h: int) -> None:
    app.page.set_viewport_size({"width": w, "height": h})


@pytest.mark.case("F19-MATRIX")
def test_no_blank_band_across_add_remove_resize_filter_sequences(app, sandbox, cli_path):
    tl = Tl(sandbox, cli_path)
    # 300 项；每 7 项挂 6 个长标签让列表行换行变高（行高不一）
    # 标记词：「十项」= 前 10 项（缩成短列表），「稀有」= 3 项（网格 ≤3 项不虚拟化）
    paths = [files.write(sandbox.files / "f19m" / f"条目{i:03d}{'-长名' * (i % 3)}{'-十项' if i < 10 else ''}"
                         f"{'-稀有' if i % 100 == 0 else ''}.txt", str(i)) for i in range(300)]
    app.seed(paths)
    tag_ids = [app.add_tag(f"很长的标签名称{i}") for i in range(6)]
    items = sorted(app.items(), key=lambda x: x["name"])
    app.invoke("set_many_item_tags", {"changes": [[it["id"], tag_ids] for it in items[::7]]})
    app.reload_page()
    p = Probe(app)
    base_vp = app.page.viewport_size or {"width": 1280, "height": 800}
    W, H = base_vp["width"], base_vp["height"]

    for mode in ("列表视图", "网格视图"):
        view(app, mode)
        wait_until(lambda: (g := app.page.evaluate(PROBE_JS, "init")) and g["rows"] > 3, 10)
        p.check(f"{mode}: 初始")

        # 1) 滚到中部 → 外部删除 40 项
        app.page.evaluate(SCROLL_JS, 0.5)
        p.check(f"{mode}: 滚到 50%")
        cur = app.items()
        tl.run("remove", *[str(it["id"]) for it in sorted(cur, key=lambda x: x["name"])[-40:]])
        wait_until(lambda: len(app.items()) == len(cur) - 40, 10)
        p.check(f"{mode}: 50% 处外部删除 40 项（按名称末 40）", 1200)

        # 2) 滚到底 → 外部新增 30 项
        app.page.evaluate(SCROLL_JS, 1.0)
        p.check(f"{mode}: 滚到底")
        new = [files.write(sandbox.files / "f19m" / f"新增{mode}{i:02d}.txt", "n") for i in range(30)]
        tl.run("add", *[str(x) for x in new])
        p.check(f"{mode}: 底部外部新增 30 项", 1500)

        # 3) 滚到底 → 缩窄 / 变矮 / 恢复（拖窗口边框）
        app.page.evaluate(SCROLL_JS, 1.0)
        for (w, h) in ((W - 420, H), (W - 420, H - 300), (W, H - 300), (W, H)):
            resize(app, w, h)
            p.check(f"{mode}: 滚到底后视口 {w}x{h}")
        app.page.evaluate(SCROLL_JS, 0.7)
        resize(app, W - 420, H)
        p.check(f"{mode}: 70% 处缩窄")
        resize(app, W, H)
        p.check(f"{mode}: 70% 处恢复宽度")

        # 4) 滚动进行中切换筛选（搜索缩短 → 清空）
        app.page.evaluate(SCROLLING_JS, [40, 600])
        app.page.wait_for_timeout(150)
        app.search("十项")
        p.check(f"{mode}: 滚动中搜索缩到 10 项")
        app.page.evaluate(SCROLLING_JS, [40, 600])
        app.page.wait_for_timeout(150)
        app.search("")
        p.check(f"{mode}: 滚动中清空搜索")

        # 5) 滚到底 → 搜索缩到 3 项（网格不虚拟化）→ 视口变矮再恢复 → 清空
        app.page.evaluate(SCROLL_JS, 1.0)
        app.search("稀有")
        p.check(f"{mode}: 底部缩成 3 项")
        resize(app, W, H - 300)
        p.check(f"{mode}: 短列表变矮")
        resize(app, W, H)
        app.search("")
        p.check(f"{mode}: 短列表清空搜索")

        # 6) 快速跳到 80%（分页占位行）后立刻切筛选
        app.page.evaluate(SCROLL_JS, 0.8)
        app.search("长名")
        p.check(f"{mode}: 80% 跳转后立刻筛选")
        app.search("")
        p.check(f"{mode}: 清空")
        app.page.evaluate(SCROLL_JS, 0.0)

    view(app, "列表视图")
    resize(app, W, H)
    summary = [{k: b.get(k) for k in ("mode", "maxGap", "gapAtFromViewportTop", "firstIndex", "scrollTop", "scrollHeight",
                                      "clientHeight", "listHeight", "rendered", "mismatch", "after3s", "virt")} for b in p.bad]
    drift = [{"mode": g["mode"], "mismatch": g["mismatch"]} for g in p.log if g and g.get("mismatch")]
    print(f"F19_DRIFT {json.dumps(drift, ensure_ascii=False)}")
    print(f"F19_SUMMARY steps={len(p.log)} bad={len(p.bad)} {json.dumps(summary, ensure_ascii=False)}")
    assert not p.bad, f"出现视口空带（复现步骤见 mode）：{json.dumps(summary, ensure_ascii=False)}"
