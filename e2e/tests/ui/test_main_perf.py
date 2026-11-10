"""主窗内存构成与首屏/滚动耗时（E-PERF-MAIN-MEM）：只测量、不设阈值，用于分页迁移前后对比。

- 内存：进程树（按 WebView2 进程类型归类：browser / renderer / gpu-process / utility / 应用主进程），
  渲染进程 JS 堆（CDP Runtime.getHeapUsage、Performance.getMetrics），图标缓存规模，后端搜索索引估算。
- 首屏：页面 timeOrigin → 首次有对象卡片提交后的下一帧（src/lib/mainPerf.ts）。
- 滚动/跳转：把列表滚到给定比例，直到视口内的卡片都已渲染出名称（分页后含取页时间）。
"""
from __future__ import annotations

import json
import statistics
import subprocess
import time

import pytest

from harness import procmem
from tests.ui.test_quick import build_library, stats

SCROLL_STEPS = [0.5, 1.0, 0.25, 0.0, 0.75, 0.1, 0.9, 0.33, 0.66, 0.0]

# 滚到 frac 处，等视口内卡片都有名称：返回 {ms, cards}
SCROLL_JS = """async (frac) => {
  const el = document.querySelector('[data-region="item-grid"], [data-region="item-list"]');
  if (!el) return null;
  const t0 = performance.now();
  el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * frac);
  const box = () => el.getBoundingClientRect();
  const ready = () => {
    const b = box();
    const cards = [...el.querySelectorAll('[data-selectable-item-id]')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom;
    });
    const pending = el.querySelectorAll('[data-item-placeholder]').length;
    return cards.length > 0 && pending === 0 && cards.every((c) => (c.querySelector('h3')?.textContent || '').length > 0) ? cards.length : 0;
  };
  for (;;) {
    await new Promise((r) => requestAnimationFrame(r));
    const n = ready();
    if (n) return { ms: performance.now() - t0, cards: n };
    if (performance.now() - t0 > 10000) return { ms: null, cards: 0 };
  }
}"""


def process_types(pids: list[int]) -> dict[int, str]:
    """WebView2 子进程类型取自命令行 --type=；取不到时记 unknown。"""
    if not pids:
        return {}
    ps = ("Get-CimInstance Win32_Process | Where-Object { @(%s) -contains $_.ProcessId } | "
          "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }") % ",".join(str(p) for p in pids)
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=60).stdout
    types = {}
    for line in out.splitlines():
        pid, _, cmd = line.partition("\t")
        if not pid.strip().isdigit():
            continue
        kind = "browser"
        for part in cmd.split():
            if part.startswith("--type="):
                kind = part[len("--type="):]
                if kind == "utility":
                    for p2 in cmd.split():
                        if p2.startswith("--utility-sub-type="):
                            kind = "utility:" + p2.split("=", 1)[1].split(".")[-1]
        types[int(pid)] = kind
    return types


def memory_breakdown(pid: int) -> dict:
    samples = []
    for _ in range(3):
        samples.append(procmem.tree_memory(pid))
        time.sleep(1)
    rows = samples[-1]["processes"]
    types = process_types([r["pid"] for r in rows])
    by_kind: dict[str, dict] = {}
    for r in rows:
        kind = "app" if r["pid"] == pid else types.get(r["pid"], "unknown")
        k = by_kind.setdefault(kind, {"count": 0, "private_mb": 0.0, "ws_mb": 0.0})
        k["count"] += 1
        k["private_mb"] = round(k["private_mb"] + r["private_mb"], 1)
        k["ws_mb"] = round(k["ws_mb"] + r["ws_mb"], 1)
    return {"private_mb": statistics.median(s["private_mb"] for s in samples),
            "working_set_mb": statistics.median(s["working_set_mb"] for s in samples),
            "by_kind": by_kind}


def renderer_heap(app) -> dict:
    cdp = app.page.context.new_cdp_session(app.page)
    try:
        cdp.send("HeapProfiler.collectGarbage")
        usage = cdp.send("Runtime.getHeapUsage")
        cdp.send("Performance.enable")
        metrics = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
    finally:
        cdp.detach()
    keep = ("JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents", "JSEventListeners", "LayoutObjects")
    return {"js_used_mb": round(usage["usedSize"] / 2**20, 1), "js_total_mb": round(usage["totalSize"] / 2**20, 1),
            **{k: (round(metrics[k] / 2**20, 1) if k.startswith("JSHeap") else metrics[k]) for k in keep if k in metrics}}


@pytest.mark.parametrize("n", [5000, 50000], ids=["5k", "50k"])
@pytest.mark.case("E-PERF-MAIN-MEM")
def test_main_memory_and_scroll(sandbox, app_factory, n):
    build_library(sandbox, n)
    app = app_factory()
    app.wait_count(n, timeout=120)
    first = app.page.evaluate("() => { const p = window.__tlMainPerf || {}; return {ms: p.firstItemsMs ?? null, count: p.firstItemsCount ?? null}; }")
    time.sleep(8)  # 启动期对账、索引预热、图标取完
    pid = app.proc.pid
    mem = memory_breakdown(pid)
    heap = renderer_heap(app)
    caches = app.page.evaluate("() => { const s = (window.__tlMainPerf || {}).stats || {}; return Object.fromEntries(Object.entries(s).map(([k, f]) => [k, f()])); }")
    dom = app.page.evaluate("() => ({cards: document.querySelectorAll('[data-selectable-item-id]').length, imgs: document.images.length})")
    scrolls = []
    for frac in SCROLL_STEPS:
        r = app.page.evaluate(SCROLL_JS, frac)
        scrolls.append({"frac": frac, **(r or {"ms": None, "cards": 0})})
        time.sleep(0.3)
    scroll_ms = [s["ms"] for s in scrolls if s["ms"] is not None]
    mem_after_scroll = memory_breakdown(pid)
    heap_after_scroll = renderer_heap(app)
    out = {
        "items": n,
        "first_items": first,
        "mem": mem,
        "heap": heap,
        "caches": caches,
        "dom": dom,
        "search_index": app.invoke("search_index_stats"),
        "scroll_ms": stats(scroll_ms),
        "scrolls": scrolls,
        "mem_after_scroll": mem_after_scroll,
        "heap_after_scroll": heap_after_scroll,
    }
    (sandbox.artifacts / f"main-perf-{n}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("MAIN_PERF", json.dumps(out, ensure_ascii=False))
    assert first["ms"] is not None and first["ms"] > 0, f"未记录首屏：{first}"
    assert len(scroll_ms) == len(SCROLL_STEPS), f"有滚动未在 10s 内出齐：{scrolls}"
