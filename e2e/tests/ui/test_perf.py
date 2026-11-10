"""性能（E-PERF-01..06），5k 对象库。阈值取 §18 的 5k 档；数字写入 run_dir/perf.json 供对比。不接管物理输入。"""
from __future__ import annotations

import json
from pathlib import Path
import time

import pytest

from harness.app import wait_until

N = 5000
RESULTS: dict = {}


def _record(run_dir, k, v):
    RESULTS[k] = v
    (run_dir / "perf.json").write_text(json.dumps(RESULTS, ensure_ascii=False, indent=1), encoding="utf-8")


@pytest.fixture(scope="module")
def big_paths(request):
    root = request.config._tl_run_dir / "perf5k"
    root.mkdir(parents=True, exist_ok=True)
    out = []
    for i in range(N):
        p = root / f"d{i // 500:02d}" / f"perf-对象-{i:05d}.txt"
        p.parent.mkdir(exist_ok=True)
        p.write_text("x", encoding="utf-8")
        out.append(p)
    return out


@pytest.fixture
def big_app(app_factory, big_paths):
    app = app_factory()
    for i in range(0, N, 1000):
        app.invoke("add_items", {"paths": [str(p) for p in big_paths[i:i + 1000]]})
    app.refresh_items()
    return app


def _ms(fn):
    t = time.perf_counter()
    fn()
    return round((time.perf_counter() - t) * 1000)


@pytest.mark.case("E-PERF-01")
def test_cold_start_tti(big_app, run_dir):
    """TTI = 进程创建 → 首个对象出现在页面（应用 main.tsx 打的 tl:first-items mark）。
    不重载页面，量的是应用自己的首次加载；测试框架连接调试端口花的时间不计入（阈值不变）。"""
    app = big_app
    app.stop()
    app.reload = False                       # 保留首次加载的页面，mark 才是冷启动那一次
    app.start()
    app.page.locator('[data-selectable-item-id]').first.wait_for(timeout=30000)
    ready = wait_until(lambda: app.page.evaluate(
        "() => { const m = performance.getEntriesByName('tl:first-items', 'mark')[0];"
        " return m ? performance.timeOrigin + m.startTime : null; }"), 10, "应用未打 tl:first-items mark")
    tti = round(ready - app.spawned_at_ms)
    phases = dict((k, v) for k, v in app._launch.phases) if getattr(app, "_launch", None) else {}
    _record(run_dir, "tti_ms_5k", {"tti": tti, "harness_phases": phases})
    assert 0 < tti <= 3000, f"5k 冷启动 TTI {tti}ms > 3000ms（harness 阶段 {phases}）"


@pytest.mark.case("E-PERF-02")
def test_view_switch(big_app, run_dir):
    pg = big_app.page
    big_app.close_welcome(3000)
    times = {}
    for label in ("列表视图", "大图标视图", "网格视图"):
        times[label] = _ms(lambda: (pg.get_by_role("button", name=label, exact=True).click(),
                                    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")))
    _record(run_dir, "view_switch_ms", times)
    assert max(times.values()) <= 300, times


@pytest.mark.case("E-PERF-03")
def test_search_cold_hot(big_app, run_dir):
    pg = big_app.page
    big_app.close_welcome(3000)
    box = pg.locator("#workspace-search")

    def search(q):
        box.fill(q)
        wait_until(lambda: big_app.scope_count() is not None and big_app.scope_count() < N, 10, lambda: big_app.scope_count())
    cold = _ms(lambda: search("对象-0123"))
    box.fill("")
    wait_until(lambda: big_app.scope_count() == N, 10, lambda: big_app.scope_count())
    hot = _ms(lambda: search("对象-0123"))
    _record(run_dir, "search_ms", {"cold": cold, "hot": hot})
    assert cold <= 800 and hot <= 250, (cold, hot)


@pytest.mark.case("E-PERF-04")
def test_scroll_fps(big_app, run_dir):
    pg = big_app.page
    big_app.close_welcome(3000)
    pg.get_by_role("button", name="列表视图", exact=True).click()
    res = pg.evaluate("""async () => {
      const els = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 500 &&
        /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      const sc = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!sc) return {err: 'no scroller'};
      const deltas = []; let last = performance.now(); const t0 = last;
      await new Promise(done => { const step = (t) => { deltas.push(t - last); last = t; sc.scrollTop += 40;
        if (t - t0 < 5000) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
      const fps = deltas.length / 5; const jank = deltas.filter(d => d > 1000 / 30).length / deltas.length;
      return {fps: Math.round(fps * 10) / 10, jank: Math.round(jank * 1000) / 1000, frames: deltas.length};
    }""")
    _record(run_dir, "scroll", res)
    assert "err" not in res, res
    assert res["fps"] >= 55 and res["jank"] < 0.05, res


@pytest.mark.case("E-PERF-05")
def test_theme_switch(big_app, run_dir):
    from ..visual.test_visual import FAMILIES
    pg = big_app.page
    big_app.close_welcome(3000)
    times = []
    for tid in (FAMILIES["樱花"][0], FAMILIES["霜靛"][0]):
        times.append(_ms(lambda: (big_app.invoke("set_current_theme", {"themeId": tid}),
                                  pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"))))
    _record(run_dir, "theme_switch_ms", times)
    assert max(times) <= 600, times


# 页面内 JS 驱动的设置开关循环（与 test_perf_diag._JS_CYCLE 一致）
_JS_CYCLE = """async (n) => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const key = (k, extra) => document.activeElement && document.activeElement !== document.body
    ? document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true, ...extra}))
    : window.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true, ...extra}));
  const dlg = () => document.querySelector('[aria-labelledby="settings-panel-title"]');
  for (let i = 0; i < n; i++) {
    key(',', {code: 'Comma', ctrlKey: true});
    for (let t = 0; t < 100 && !dlg(); t++) await sleep(20);
    if (!dlg()) return 'open-failed@' + i;
    const btn = [...dlg().querySelectorAll('nav button')].find(b => b.textContent.trim() === '主题外观');
    btn && btn.click();
    await sleep(30);
    key('Escape', {code: 'Escape'});
    for (let t = 0; t < 100 && dlg(); t++) await sleep(20);
    if (dlg()) return 'close-failed@' + i;
  }
  return 'ok';
}"""


@pytest.mark.case("E-PERF-06")
def test_memory_no_growth(app, run_dir):
    # BUG-20 结论：此前约 45 KB/次的增长是测试工具伪影——Playwright 定位器操作经 DevTools
    # 留下的远程句柄（堆快照保留链根为 "DevTools console"）钉住了每次关闭后的设置面板 DOM。
    # 改为页面内 JS 驱动开关（不产生 DevTools 句柄），直接断言堆与 DOM 节点不线性增长。
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Performance.enable")

    def sample():
        cdp.send("HeapProfiler.collectGarbage")
        m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        return m["JSHeapUsedSize"], cdp.send("Memory.getDOMCounters")["nodes"]

    # 先 50 次预热（首开懒加载的模块/缓存计入基线），再 50 次看是否继续线性增长
    assert pg.evaluate(_JS_CYCLE, 50) == "ok"
    h0, n0 = sample()
    assert pg.evaluate(_JS_CYCLE, 50) == "ok"
    h1, n1 = sample()
    growth = (h1 - h0) / h0
    _record(run_dir, "heap", {"before": h0, "after": h1, "growth": round(growth, 3),
                              "dom_nodes_before": n0, "dom_nodes_after": n1})
    assert growth < 0.1, f"开关设置工作台 50 次 JS 堆增长 {growth:.1%}"
    assert n1 - n0 < 200, f"开关设置工作台 50 次 DOM 节点增加 {n1 - n0}"
