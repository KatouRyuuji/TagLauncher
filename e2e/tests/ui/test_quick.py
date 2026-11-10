"""全局极速阶段②：快速搜索窗（E-QUICK-*，E-PERF-QUICK-*）。

- 唤出走与热键同一入口 quick_open（后端 show → 发 quick-shown{t0Ms}）。E2E 传 activate=false：
  测试机守护不允许应用抢前台，所以「热键时的系统焦点切换」需真机确认；输入框聚焦仍在页面内断言。
- 性能口径（设计目标，不放宽）：
  唤出 → 输入框已聚焦后的下一帧 p95 ≤ 80 ms；
  输入事件 → 结果提交后的下一帧 p95：5k ≤ 30 ms、50k ≤ 100 ms；
  预创建并加载完数据、隐藏常驻时，应用进程树（含 WebView2 子进程）私有内存增量：5k ≤ 60 MB、50k ≤ 120 MB。
"""
from __future__ import annotations

import json
import statistics
import time

import pytest

from harness import db as dbh
from harness import files
from harness import procmem
from harness.app import wait_until
from tests.cli.conftest import Tl

HOTKEY = "Ctrl+Alt+Shift+F10"
SUMMON_P95_MS = 80
QUERY_P95_MS = {5000: 30, 50000: 100}
HIDDEN_MEM_MB = {5000: 60, 50000: 120}


# ---------------------------------------------------------------- helpers
def quick_pages(app):
    return [p for ctx in app.browser.contexts for p in ctx.pages if "quick.html" in (p.url or "") and not p.is_closed()]


def _cdp_targets(app) -> list[dict]:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{app.port}/json/list", timeout=2) as r:
            return [{"type": t.get("type"), "url": t.get("url")} for t in json.loads(r.read().decode("utf-8", "replace"))]
    except Exception as e:  # noqa: BLE001
        return [{"error": str(e)}]


def _quick_diag(app) -> str:
    labels = app.page.evaluate("() => window.__TAURI__.window.getAllWindows().then(ws => ws.map(w => w.label))")
    logs = []
    for f in app.sb.root.rglob("*.log"):
        try:
            logs += [ln.strip() for ln in f.read_text(encoding="utf-8", errors="replace").splitlines() if "quick" in ln.lower()]
        except OSError:
            pass
    return f"windows={labels} cdp={_cdp_targets(app)} logs={logs[-8:]}"


def quick_page(app, timeout: float = 20):
    """快速窗是第二个 WebView：Playwright 的 CDP 连接按 target 自动挂接；挂接不到时另开一条连接兜底。"""
    extra = []

    def find():
        if ps := quick_pages(app):
            return ps[0]
        if any("quick.html" in (t.get("url") or "") for t in _cdp_targets(app)):
            if not extra:
                extra.append(app.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{app.port}"))
            for ctx in extra[0].contexts:
                for p in ctx.pages:
                    if "quick.html" in (p.url or "") and not p.is_closed():
                        return p
        return None

    try:
        page = wait_until(find, timeout, "快速搜索窗页面未出现")
    except AssertionError as e:
        raise AssertionError(f"{e}；{_quick_diag(app)}") from None
    page.wait_for_function("() => !!document.querySelector('[data-testid=quick-input]')", timeout=15000)
    # 桩（不真正启动程序/打开资源管理器、剪贴板只记录）随 context init script 注入；保险起见补一次
    if not page.evaluate("() => !!window.__e2e"):
        from harness.app import STUB_JS
        page.evaluate(STUB_JS)
    return page


def enable_quick(app):
    s = app.invoke("set_hotkey", {"action": "open_quick", "shortcut": HOTKEY})
    [h] = [h for h in s["hotkeys"] if h["action"] == "open_quick"]
    assert h["accelerator"] and h["error"] is None, s
    return quick_page(app)


def perf(qp) -> dict:
    return qp.evaluate("() => window.__tlQuickPerf || {summons: [], queries: [], loads: []}")


def wait_loaded(qp, n: int, timeout: float = 60) -> dict:
    return wait_until(lambda: next((l for l in reversed(perf(qp)["loads"]) if l["items"] == n), None), timeout,
                      lambda: f"快速窗未加载完 {n} 项：{perf(qp)['loads']}")


def summon(app, qp) -> dict:
    before = len(perf(qp)["summons"])
    app.page.evaluate("() => window.__TAURI__.core.invoke('quick_open', { t0Ms: Date.now(), activate: false })")
    return wait_until(lambda: (s := perf(qp)["summons"]) and len(s) > before and s[-1], 5, "未记录唤出")


def hide(app):
    app.invoke("quick_hide")


def is_visible(qp) -> bool:
    return qp.evaluate("() => window.__TAURI__.window.getCurrentWindow().isVisible()")


def result_ids(qp) -> list[int]:
    return [int(x) for x in qp.eval_on_selector_all("[data-testid=quick-result]", "els => els.map(e => e.dataset.itemId)")]


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, round(0.95 * len(xs)) - 1))]


def stats(xs):
    return {"n": len(xs), "p50": round(statistics.median(xs), 1), "p95": round(p95(xs), 1), "max": round(max(xs), 1)}


# ---------------------------------------------------------------- 功能
@pytest.mark.case("E-QUICK-01")
def test_quick_window_follows_hotkey_binding(app, sandbox):
    """默认不绑键 = 不建窗；绑定即预创建（隐藏）；重启后按设置预创建；清除即销毁。"""
    time.sleep(2.5)  # 超过预创建延迟：默认不应出现
    assert quick_pages(app) == []
    qp = enable_quick(app)
    assert not is_visible(qp), "预创建的快速窗应保持隐藏，唤出时才显示"
    assert dbh.meta(sandbox.db_path, "hotkey.open_quick") == HOTKEY
    app.stop()
    app.start()
    qp = quick_page(app, timeout=30)
    assert not is_visible(qp)
    s = app.invoke("set_hotkey", {"action": "open_quick", "shortcut": None})
    assert all(h["accelerator"] is None for h in s["hotkeys"] if h["action"] == "open_quick"), s
    wait_until(lambda: quick_pages(app) == [], 10, "清除快捷键后快速窗应被销毁")


@pytest.mark.case("E-QUICK-02")
def test_quick_search_and_keyboard_actions(app, sandbox):
    paths = [files.write(sandbox.files / "quick" / n, "x") for n in
             ("项目文档.txt", "Visual Studio Code.txt", "设计稿.txt", "report-2026.txt")]
    app.seed(paths)
    tag = app.invoke("add_tag", {"name": "快速标签", "color": "#5064d8"})
    qp = enable_quick(app)
    wait_loaded(qp, 4)
    s = summon(app, qp)
    assert s["focused"], "唤出后输入框应已聚焦"
    assert is_visible(qp)
    inp = qp.get_by_test_id("quick-input")
    inp.fill("")
    inp.press_sequentially("xmwd")
    target = app.item("项目文档.txt")["id"]
    wait_until(lambda: result_ids(qp) == [target], 3, lambda: result_ids(qp))

    # Ctrl+Shift+C 复制路径（剪贴板桩只记录）
    inp.press("Control+Shift+C")
    wait_until(lambda: qp.evaluate("() => window.__e2e.clipboard.at(-1)") == app.item("项目文档.txt")["path"], 3)
    # Ctrl+Enter 显示位置（open_in_explorer_by_id 默认被桩掉）
    inp.press("Control+Enter")
    wait_until(lambda: [c["args"].get("id") for c in qp.evaluate("() => window.__e2e.callsOf('open_in_explorer_by_id')")] == [target], 3)
    wait_until(lambda: not is_visible(qp), 3, "显示位置后应收起")

    # Ctrl+T 打标签 → 主窗按 ID 增量刷新（不整表重载）
    summon(app, qp)
    full_loads = len(app.calls("get_items"))
    inp.press("Control+t")
    tag_inp = qp.get_by_test_id("quick-tag-input")
    tag_inp.wait_for(timeout=3000)
    tag_inp.press_sequentially("快速")
    tag_inp.press("Enter")
    qp.get_by_test_id("quick-status").filter(has_text="已添加标签「快速标签」").wait_for(timeout=3000)
    card = app.card("项目文档.txt")
    wait_until(lambda: "快速标签" in card.inner_text(), 2, lambda: card.inner_text())
    assert [t["id"] for t in app.item("项目文档.txt")["tags"]] == [tag["id"]]
    assert len(app.calls("get_items")) == full_loads, "快速窗打标签后主窗应按 ID 增量刷新，而不是整表重载"
    assert app.calls("get_items_by_ids"), "主窗应按对象 ID 取回变化"
    tag_inp.press("Escape")

    # Enter 打开（桩掉真实启动），打开后收起
    qp.evaluate("() => window.__e2e.stub('launch_item', { value: null })")
    inp.press("Enter")
    wait_until(lambda: [c["args"].get("id") for c in qp.evaluate("() => window.__e2e.callsOf('launch_item')")] == [target], 3)
    wait_until(lambda: not is_visible(qp), 3, "打开后应收起")

    # Esc：先清空，再收起
    summon(app, qp)
    inp.press("Escape")
    assert inp.input_value() == ""
    assert is_visible(qp)
    inp.press("Escape")
    wait_until(lambda: not is_visible(qp), 3, "空输入时 Esc 应收起")

    # 在主窗定位：主窗侧收到 quick-locate 后清空筛选并选中目标（后端 show_main_window 会抢焦点，E2E 不走它）
    qp.evaluate(f"() => window.__TAURI__.event.emit('quick-locate', {{ id: {target} }})")
    wait_until(lambda: app.selected_ids() == [target], 3, lambda: app.selected_ids())


@pytest.mark.case("E-QUICK-03")
def test_quick_window_reflects_external_writes(app, sandbox, cli_path):
    """tl CLI 在后台加对象：快速窗（隐藏中）经 data-changed 自动重载，唤出即可搜到。"""
    tl = Tl(sandbox, cli_path)
    qp = enable_quick(app)
    wait_loaded(qp, 0)
    f = files.write(sandbox.files / "quick3" / "外部新增工具.txt", "x")
    tl.run("add", str(f))
    wait_loaded(qp, 1, timeout=10)
    summon(app, qp)
    qp.get_by_test_id("quick-input").fill("外部新增")
    wait_until(lambda: len(result_ids(qp)) == 1, 3, lambda: result_ids(qp))
    hide(app)


# ---------------------------------------------------------------- 性能
WORDS = ["Visual Studio Code", "项目文档", "设计稿", "report", "game launcher", "会议纪要", "photo album",
         "工具箱", "music player", "数据备份", "notes", "财务报表", "terminal", "壁纸合集", "browser", "源码"]
QUERIES = ["vsc", "xmwd", "report 1", "设计", "gl", "hyjy", "tool", "sjbf", "note", "cwbb"]


def build_library(sandbox, n: int):
    root = str(sandbox.files / "perf-missing")
    items = [(f"{WORDS[i % len(WORDS)]} {i:05d}.txt", f"{root}\\{i // 1000:02d}\\obj{i:05d}.txt", "text") for i in range(n)]
    dbh.create_legacy_db(sandbox.db_path, "20", items)


@pytest.mark.parametrize("n", [5000, 50000], ids=["5k", "50k"])
@pytest.mark.case("E-PERF-QUICK")
def test_quick_window_performance(sandbox, app_factory, n):
    build_library(sandbox, n)
    app = app_factory()
    app.wait_count(n, timeout=120)
    time.sleep(5)  # 启动期对账、索引预热结束
    pid = app.proc.pid

    def mem():
        samples = []
        for _ in range(3):
            samples.append(procmem.tree_memory(pid))
            time.sleep(1)
        return {"private_mb": statistics.median(s["private_mb"] for s in samples),
                "working_set_mb": statistics.median(s["working_set_mb"] for s in samples),
                "processes": samples[-1]["processes"]}

    before = mem()
    qp = enable_quick(app)
    load = wait_loaded(qp, n, timeout=120)
    time.sleep(8)  # 隐藏常驻稳定（GC、索引建完）
    after = mem()
    hidden_delta = round(after["private_mb"] - before["private_mb"], 1)
    hidden_ws_delta = round(after["working_set_mb"] - before["working_set_mb"], 1)

    summons = []
    for _ in range(20):
        summons.append(summon(app, qp)["ms"])
        hide(app)
        time.sleep(0.3)

    summon(app, qp)
    inp = qp.get_by_test_id("quick-input")
    base = len(perf(qp)["queries"])
    for q in QUERIES:
        inp.fill("")  # 清空（空查询的采样不计入）
        for ch in q:
            inp.press_sequentially(ch)
            time.sleep(0.06)
    queries = [x for x in perf(qp)["queries"][base:] if x["q"]]
    query_ms = [x["ms"] for x in queries]
    hide(app)

    out = {
        "items": n,
        "load_ms": round(load["ms"]),
        "summon_ms": stats(summons),
        "query_ms": stats(query_ms),
        "hidden_private_mb_delta": hidden_delta,
        "hidden_working_set_mb_delta": hidden_ws_delta,
        "mem_before": {k: before[k] for k in ("private_mb", "working_set_mb")},
        "mem_after": {k: after[k] for k in ("private_mb", "working_set_mb")},
        "processes_after": after["processes"],
        "slowest_queries": sorted(queries, key=lambda x: -x["ms"])[:5],
        "targets": {"summon_p95": SUMMON_P95_MS, "query_p95": QUERY_P95_MS[n], "hidden_mb": HIDDEN_MEM_MB[n]},
    }
    (sandbox.artifacts / f"quick-perf-{n}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("QUICK_PERF", json.dumps({k: v for k, v in out.items() if k not in ("processes_after",)}, ensure_ascii=False))

    assert len(query_ms) >= 25, f"输入采样太少：{len(query_ms)}"
    problems = []
    if out["summon_ms"]["p95"] > SUMMON_P95_MS:
        problems.append(f"唤出到可输入 p95 {out['summon_ms']['p95']}ms > {SUMMON_P95_MS}ms")
    if out["query_ms"]["p95"] > QUERY_P95_MS[n]:
        problems.append(f"输入到出结果 p95 {out['query_ms']['p95']}ms > {QUERY_P95_MS[n]}ms")
    if hidden_delta > HIDDEN_MEM_MB[n]:
        problems.append(f"隐藏常驻私有内存增量 {hidden_delta}MB > {HIDDEN_MEM_MB[n]}MB")
    assert not problems, "；".join(problems) + f"（详见 quick-perf-{n}.json）"
