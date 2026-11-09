"""BUG-20 诊断（默认跳过，TL_E2E_DIAG=1 启用）：开关设置工作台的内存增长来源。
区分 JS 堆（堆快照按构造器聚合的数量/自身大小差）、事件监听器与 DOM 节点（Memory.getDOMCounters）。
结果写入 run_dir/bug20-diag.json。不接管物理输入。"""
from __future__ import annotations

import collections
import json
import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("TL_E2E_DIAG") != "1", reason="诊断用例，需 TL_E2E_DIAG=1")


def _snapshot(cdp) -> dict[str, list[int]]:
    chunks: list[str] = []
    handler = lambda e: chunks.append(e["chunk"])
    cdp.on("HeapProfiler.addHeapSnapshotChunk", handler)
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.takeHeapSnapshot", {"reportProgress": False})
    cdp.remove_listener("HeapProfiler.addHeapSnapshotChunk", handler)
    snap = json.loads("".join(chunks))
    meta = snap["snapshot"]["meta"]
    fields = meta["node_fields"]
    nf = len(fields)
    ti, ni, si = fields.index("type"), fields.index("name"), fields.index("self_size")
    types = meta["node_types"][0]
    strings = snap["strings"]
    nodes = snap["nodes"]
    agg: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    for i in range(0, len(nodes), nf):
        t = types[nodes[i + ti]]
        name = strings[nodes[i + ni]] if t in ("object", "closure", "native", "regexp") else f"({t})"
        if t == "closure":
            name = f"closure {name}"
        a = agg[name[:120]]
        a[0] += 1
        a[1] += nodes[i + si]
    return agg


def test_bug20_settings_cycle_diag(app, run_dir):
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Performance.enable")
    cdp.send("HeapProfiler.enable")

    def counters():
        cdp.send("HeapProfiler.collectGarbage")
        m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        d = cdp.send("Memory.getDOMCounters")
        return {"heap": m["JSHeapUsedSize"], "nodes": d["nodes"], "listeners": d["jsEventListeners"],
                "documents": d["documents"]}

    def cycle():
        pg.keyboard.press("Control+Comma")
        app.dialog("设置工作台").get_by_role("navigation", name="设置区块导航").get_by_role(
            "button", name="主题外观", exact=True).click()
        pg.keyboard.press("Escape")
        pg.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=5000)

    for _ in range(50):
        cycle()
    c0 = counters()
    s0 = _snapshot(cdp)
    series = [c0]
    for k in range(50):
        cycle()
        if k % 10 == 9:
            series.append(counters())
    c1 = counters()
    s1 = _snapshot(cdp)
    diff = []
    for name in set(s0) | set(s1):
        a, b = s0.get(name, [0, 0]), s1.get(name, [0, 0])
        if b[0] != a[0] or b[1] != a[1]:
            diff.append({"name": name, "d_count": b[0] - a[0], "d_size": b[1] - a[1], "count": b[0]})
    diff.sort(key=lambda x: -x["d_size"])
    out = {"before": c0, "after": c1, "series": series,
           "per_cycle_heap": (c1["heap"] - c0["heap"]) / 50,
           "top_size": diff[:40], "top_count": sorted(diff, key=lambda x: -x["d_count"])[:40]}
    (run_dir / "bug20-diag.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def _retainers(cdp, needle: str, max_paths: int = 3, depth: int = 14) -> list[list[str]]:
    """在堆快照里找名字含 needle 的节点，沿反向边回溯到根，返回若干条保留路径（近→远）。"""
    chunks: list[str] = []
    handler = lambda e: chunks.append(e["chunk"])
    cdp.on("HeapProfiler.addHeapSnapshotChunk", handler)
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.takeHeapSnapshot", {"reportProgress": False})
    cdp.remove_listener("HeapProfiler.addHeapSnapshotChunk", handler)
    snap = json.loads("".join(chunks))
    meta = snap["snapshot"]["meta"]
    nfields, efields = meta["node_fields"], meta["edge_fields"]
    nf, ef = len(nfields), len(efields)
    n_name, n_ec, n_type = nfields.index("name"), nfields.index("edge_count"), nfields.index("type")
    e_type, e_name, e_to = efields.index("type"), efields.index("name_or_index"), efields.index("to_node")
    ntypes, etypes = meta["node_types"][0], meta["edge_types"][0]
    S, N, E = snap["strings"], snap["nodes"], snap["edges"]
    count = len(N) // nf
    rev: dict[int, list[tuple[int, str]]] = collections.defaultdict(list)
    ei = 0
    for i in range(count):
        for _ in range(N[i * nf + n_ec]):
            et = etypes[E[ei + e_type]]
            if et != "weak":
                nm = S[E[ei + e_name]] if et in ("context", "property", "internal", "shortcut") else str(E[ei + e_name])
                rev[E[ei + e_to] // nf].append((i, f"{et}:{nm}"))
            ei += ef
    label = lambda i: f"{ntypes[N[i * nf + n_type]]}:{S[N[i * nf + n_name]][:80]}"
    targets = [i for i in range(count) if needle in S[N[i * nf + n_name]]][:max_paths]
    paths = []
    for t in targets:
        path, cur, seen = [label(t)], t, {t}
        for _ in range(depth):
            cands = [r for r in rev.get(cur, []) if r[0] not in seen]
            if not cands:
                break
            # 优先非 DOM 树内部的保留者（JS 对象/闭包/上下文），更接近泄漏源
            cands.sort(key=lambda r: (ntypes[N[r[0] * nf + n_type]] == "native", r[1].startswith("internal")))
            src, edge = cands[0]
            path.append(f"<-[{edge}]- {label(src)}")
            seen.add(src)
            cur = src
        paths.append(path)
    return paths


def test_bug20_retainers(app, run_dir):
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("HeapProfiler.enable")

    def cycle():
        pg.keyboard.press("Control+Comma")
        app.dialog("设置工作台").get_by_role("navigation", name="设置区块导航").get_by_role(
            "button", name="主题外观", exact=True).click()
        pg.keyboard.press("Escape")
        pg.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=5000)

    dom = "() => ({all: document.getElementsByTagName('*').length, gallery: document.querySelectorAll('[data-theme-family-gallery]').length})"
    d0 = pg.evaluate(dom)
    for _ in range(20):
        cycle()
    d1 = pg.evaluate(dom)
    out = {"dom_before": d0, "dom_after": d1,
           "paths_gallery_span": _retainers(cdp, 'h-1.5 min-w-0 flex-1 rounded-sm'),
           "paths_detached": _retainers(cdp, "Detached ")}
    (run_dir / "bug20-retainers.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def test_bug20_gc_settle(app, run_dir):
    """验证保留的 DOM 是否只是未回收的垃圾：多轮强制 GC + 等待后计数是否回落。"""
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("HeapProfiler.enable")

    def counters():
        c = cdp.send("Memory.getDOMCounters")
        h = pg.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize : 0")
        return {"nodes": c["nodes"], "listeners": c["jsEventListeners"], "heap": h}

    def gc(rounds):
        for _ in range(rounds):
            cdp.send("HeapProfiler.collectGarbage")
            pg.wait_for_timeout(300)

    gc(3)
    base = counters()
    for _ in range(50):
        pg.keyboard.press("Control+Comma")
        app.dialog("设置工作台").get_by_role("navigation", name="设置区块导航").get_by_role(
            "button", name="主题外观", exact=True).click()
        pg.keyboard.press("Escape")
        pg.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=5000)
    cdp.send("HeapProfiler.collectGarbage")
    after1 = counters()
    gc(10)
    after10 = counters()
    try:
        pass  # forciblyPurgeJavaScriptMemory 在 WebView2 下会挂起，已移除
    except Exception:
        pass
    gc(5)
    purged = counters()
    out = {"base": base, "after_1gc": after1, "after_10gc": after10, "after_purge": purged}
    (run_dir / "bug20-gc.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def _root_paths(cdp, needle: str, max_paths: int = 4):
    """从 GC 根正向 BFS（忽略弱边），统计 needle 节点可达数，并给出若干条最短保留链（根→目标）。"""
    chunks: list[str] = []
    handler = lambda e: chunks.append(e["chunk"])
    cdp.on("HeapProfiler.addHeapSnapshotChunk", handler)
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.takeHeapSnapshot", {"reportProgress": False})
    cdp.remove_listener("HeapProfiler.addHeapSnapshotChunk", handler)
    snap = json.loads("".join(chunks))
    meta = snap["snapshot"]["meta"]
    nfields, efields = meta["node_fields"], meta["edge_fields"]
    nf, ef = len(nfields), len(efields)
    n_name, n_ec, n_type = nfields.index("name"), nfields.index("edge_count"), nfields.index("type")
    n_det = nfields.index("detachedness") if "detachedness" in nfields else None
    e_type, e_name, e_to = efields.index("type"), efields.index("name_or_index"), efields.index("to_node")
    ntypes, etypes = meta["node_types"][0], meta["edge_types"][0]
    S, N, E = snap["strings"], snap["nodes"], snap["edges"]
    count = len(N) // nf
    first = [0] * (count + 1)
    for i in range(count):
        first[i + 1] = first[i] + N[i * nf + n_ec] * ef
    parent = [-1] * count
    pedge = [""] * count
    parent[0] = 0
    q = collections.deque([0])
    while q:
        i = q.popleft()
        for ei in range(first[i], first[i + 1], ef):
            et = etypes[E[ei + e_type]]
            if et == "weak":
                continue
            t = E[ei + e_to] // nf
            if parent[t] == -1:
                parent[t] = i
                nm = S[E[ei + e_name]] if et in ("context", "property", "internal", "shortcut") else str(E[ei + e_name])
                pedge[t] = f"{et}:{nm}"
                q.append(t)
    label = lambda i: f"{ntypes[N[i * nf + n_type]]}:{S[N[i * nf + n_name]][:90]}"
    targets = [i for i in range(count) if ntypes[N[i * nf + n_type]] == "native" and needle in S[N[i * nf + n_name]]]
    reach = [t for t in targets if parent[t] != -1]
    det = collections.Counter(N[t * nf + n_det] for t in targets) if n_det is not None else {}
    paths = []
    for t in reach[-max_paths:]:
        chain, cur = [], t
        while cur != 0 and len(chain) < 60:
            chain.append(f"{label(cur)} <-[{pedge[cur]}]")
            cur = parent[cur]
        paths.append(list(reversed(chain)))
    return {"targets": len(targets), "reachable": len(reach), "detachedness": dict(det), "paths": paths}


def test_bug20_rootpaths(app, run_dir):
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("HeapProfiler.enable")
    for _ in range(10):
        pg.keyboard.press("Control+Comma")
        app.dialog("设置工作台").get_by_role("navigation", name="设置区块导航").get_by_role(
            "button", name="主题外观", exact=True).click()
        pg.keyboard.press("Escape")
        pg.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=5000)
    out = _root_paths(cdp, "h-1.5 min-w-0 flex-1 rounded-sm")
    (run_dir / "bug20-rootpaths.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def test_bug20_console_retention(app, run_dir):
    """DevTools console 是否是保留者：记录控制台消息，丢弃控制台条目后 GC，看 DOM 计数是否回落。"""
    pg = app.page
    msgs: list[str] = []
    pg.on("console", lambda m: msgs.append(f"{m.type}: {m.text[:200]}"))
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("HeapProfiler.enable")
    nodes = lambda: cdp.send("Memory.getDOMCounters")["nodes"]
    cdp.send("HeapProfiler.collectGarbage")
    base = nodes()
    for _ in range(20):
        pg.keyboard.press("Control+Comma")
        app.dialog("设置工作台").get_by_role("navigation", name="设置区块导航").get_by_role(
            "button", name="主题外观", exact=True).click()
        pg.keyboard.press("Escape")
        pg.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=5000)
    cdp.send("HeapProfiler.collectGarbage")
    after = nodes()
    cdp.send("Runtime.enable")
    cdp.send("Runtime.discardConsoleEntries")
    for _ in range(3):
        cdp.send("HeapProfiler.collectGarbage")
        pg.wait_for_timeout(200)
    discarded = nodes()
    out = {"base": base, "after": after, "after_discard_console": discarded,
           "console_count": len(msgs), "console_sample": msgs[:30]}
    (run_dir / "bug20-console.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


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


def test_bug20_no_locator_cycles(app, run_dir):
    """不经 Playwright 定位器（无 DevTools 远程句柄），纯页面内 JS 开关设置，判断泄漏是否为测试工具伪影。"""
    pg = app.page
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("HeapProfiler.enable")
    nodes = lambda: cdp.send("Memory.getDOMCounters")
    cdp.send("HeapProfiler.collectGarbage")
    base = nodes()
    r1 = pg.evaluate(_JS_CYCLE, 20)
    cdp.send("HeapProfiler.collectGarbage")
    mid = nodes()
    r2 = pg.evaluate(_JS_CYCLE, 20)
    cdp.send("HeapProfiler.collectGarbage")
    end = nodes()
    out = {"r1": r1, "r2": r2, "base": base, "after20": mid, "after40": end}
    (run_dir / "bug20-nolocator.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    assert r1 == "ok" and r2 == "ok"
