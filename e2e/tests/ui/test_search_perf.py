"""主窗搜索耗时（E-PERF-MAIN-SEARCH）：只测量、不设阈值，用于搜索实现迁移前后对比。

口径（与 src/lib/searchPerf.ts 一致）：
- apply：防抖结束、搜索词生效 → 该词结果提交后的下一帧（搜索本身）；
- input：输入该词 → 结果提交后的下一帧（含 150ms 防抖）。
每个字之间停顿超过防抖，使每个前缀都单独生效一次。
"""
from __future__ import annotations

import json
import time

import pytest

from harness.app import wait_until
from tests.ui.test_quick import QUERIES, build_library, stats


def records(app) -> list[dict]:
    return app.page.evaluate("() => (window.__tlMainSearchPerf && window.__tlMainSearchPerf.records) || []")


@pytest.mark.parametrize("n", [5000, 50000], ids=["5k", "50k"])
@pytest.mark.case("E-PERF-MAIN-SEARCH")
def test_main_search_latency(sandbox, app_factory, n):
    build_library(sandbox, n)
    app = app_factory()
    app.wait_count(n, timeout=120)
    time.sleep(5)  # 启动期对账结束
    box = app.page.locator("#workspace-search")
    # 预热：首个搜索词会懒加载拼音分片/建索引，单独记一次、不计入稳态
    box.fill("warm")
    wait_until(lambda: any(r["q"] == "warm" for r in records(app)), 60, "预热搜索未出结果")
    first = next(r for r in records(app) if r["q"] == "warm")
    box.fill("")
    time.sleep(0.5)
    base = len(records(app))
    for q in QUERIES:
        box.fill("")
        time.sleep(0.3)
        for ch in q:
            box.press_sequentially(ch)
            time.sleep(0.35)
        wait_until(lambda: any(r["q"] == q for r in records(app)[base:]), 30, lambda: f"{q} 未出结果")
    time.sleep(0.5)
    got = [r for r in records(app)[base:] if r["q"].strip()]
    apply_ms = [r["applyMs"] for r in got if r["applyMs"] is not None]
    input_ms = [r["inputMs"] for r in got if r["inputMs"] is not None]
    out = {
        "items": n,
        "first_query": first,
        "apply_ms": stats(apply_ms),
        "input_ms": stats(input_ms),
        "samples": len(got),
        "slowest": sorted(got, key=lambda r: -(r["applyMs"] or 0))[:5],
        "results": {r["q"]: r["results"] for r in got},
    }
    (sandbox.artifacts / f"main-search-perf-{n}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("MAIN_SEARCH_PERF", json.dumps(out, ensure_ascii=False))
    assert len(apply_ms) >= 25, f"采样太少：{len(apply_ms)}（{got}）"
