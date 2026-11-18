"""全局极速阶段②：快速搜索窗（E-QUICK-*，E-PERF-QUICK-*）。

- 唤出走与热键同一入口 quick_open（后端 show → 发 quick-shown{t0Ms}）。E2E 传 activate=false：
  测试机守护不允许应用抢前台，所以「热键时的系统焦点切换」需真机确认；输入框聚焦仍在页面内断言。
- 性能口径：
  唤出 → 输入框已聚焦后的下一帧 p95 ≤ 80 ms、p99 ≤ 150 ms（100 次）；
  输入事件 → 结果提交后的下一帧 p95：5k ≤ 35 ms、50k ≤ 100 ms；
  预创建并加载完数据、隐藏常驻时，应用进程树（含 WebView2 子进程）私有内存增量：5k ≤ 60 MB、50k ≤ 120 MB；
  两窗都隐藏时 120 s 平均 CPU ≤ 单核 1%（E-PERF-IDLE）。
"""
from __future__ import annotations

import json
import os
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
SUMMON_P99_MS = 150  # §3.3：p99 ≤ 150 ms（100 次唤出，p99 才有意义）
SUMMONS = 100
CROSS_WINDOW_MS = 300  # §3.3：快速窗打标签后主窗可见 ≤ 300 ms
QUERY_P95_MS = {5000: 35, 50000: 100}
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
    # 应用日志（tauri-plugin-log，<LOCALAPPDATA>/com.taglauncher.app/logs）；WebView2 的 leveldb LOG 不是文本，跳过
    logs = []
    for f in sorted((app.sb.root / "LocalAppData").glob("com.taglauncher.app/logs/*.log")):
        try:
            logs += [ln.strip() for ln in f.read_text(encoding="utf-8", errors="replace").splitlines()
                     if any(k in ln.lower() for k in ("quick", "collect", "desktop", "warn", "error"))]
        except OSError:
            pass
    try:
        session = app.invoke("collect_session")
    except Exception as e:  # noqa: BLE001
        session = f"<{e}>"
    pages = []
    for p in quick_pages(app):
        try:
            pages.append(p.evaluate("() => ({ready: document.readyState, collect: !!document.querySelector('[data-testid=quick-collect]'),"
                                    " input: !!document.querySelector('[data-testid=quick-input]'), text: document.body.innerText.slice(0, 160),"
                                    " perf: (window.__tlCollectPerf || []).length})"))
        except Exception as e:  # noqa: BLE001
            pages.append(f"<{type(e).__name__}: {str(e)[:120]}>")
    return f"windows={labels} cdp={_cdp_targets(app)} quick_pages={pages} collect_session={session} logs={logs[-12:]}"


class QuickPageFinder:
    """在所有 CDP 连接里找快速窗页面（E-COLLECT-03/05 根治）。

    根因：Playwright 主 CDP 连接偶发不挂接销毁重建/重新显示后的 WebView target；旧兜底只开一次备用连接，
    且 connect_over_cdp 默认 30s 超时——备用连接本身卡住或同样没挂上时，整个等待额度被一次调用耗尽
    （E-COLLECT-03 失败现场：超时后主连接立刻能看到已渲染的收纳页）。
    现在：主连接优先；/json/list 里有 quick.html target 而主连接看不到时才用备用连接，连接限时 5s，
    且每 3s 没找到就弃用旧连接重建，保证单次 find 有界、换新连接重新挂接。"""

    CONNECT_TIMEOUT_MS = 5000
    REBUILD_AFTER_S = 3.0

    def __init__(self, app, pred: str | None = None):
        self.app = app
        self.pred = pred  # 页面就绪判断（JS 表达式）；None 表示只要 URL 匹配
        self.extra = None
        self.extra_at = 0.0
        self.via = None

    def _ok(self, p) -> bool:
        if p.is_closed() or "quick.html" not in (p.url or ""):
            return False
        if self.pred is None:
            return True
        try:
            return bool(p.evaluate(self.pred))
        except Exception:  # noqa: BLE001  页面在销毁/导航中
            return False

    def _extra_pages(self):
        now = time.monotonic()
        if self.extra is not None and now - self.extra_at > self.REBUILD_AFTER_S:
            self.close()
        if self.extra is None:
            try:
                self.extra = self.app.connect_cdp(
                    "quick-finder-extra", timeout=self.CONNECT_TIMEOUT_MS)
            except Exception:  # noqa: BLE001  下轮重试
                return []
            self.extra_at = time.monotonic()
        return [p for ctx in self.extra.contexts for p in ctx.pages]

    def find(self):
        main = quick_pages(self.app)
        for p in main:
            if self._ok(p):
                self.via = "main"
                return p
        if any("quick.html" in (t.get("url") or "") for t in _cdp_targets(self.app)):
            for p in self._extra_pages():
                if self._ok(p):
                    self.via = "extra"
                    return p
        return None

    def close(self):
        """断开备用连接（只断 websocket）。页面若已交给会话使用，调用方应走 release() 而不是 close()。"""
        if self.extra is not None:
            self.app.disconnect_cdp(self.extra, reason="quick-finder-close")
        self.extra = None

    def release(self):
        """find 结束后的所有权：备用连接上找到的 page 留在 AppSession 注册表，其余断开。"""
        if self.via == "extra":
            self.extra = None
            return
        self.close()


def quick_page(app, timeout: float = 20):
    """快速窗是第二个 WebView：Playwright 的 CDP 连接按 target 自动挂接；挂接不到时用会定期重建的备用连接兜底。"""
    finder = QuickPageFinder(app)
    find = finder.find

    try:
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
    finally:
        finder.release()


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


def pct(xs, q: float):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, round(q * len(xs)) - 1))]


def p95(xs):
    return pct(xs, 0.95)


def stats(xs):
    return {"n": len(xs), "p50": round(statistics.median(xs), 1), "p95": round(p95(xs), 1), "p99": round(pct(xs, 0.99), 1),
            "max": round(max(xs), 1)}


# ---------------------------------------------------------------- 功能
def test_precreated_quick_stays_hidden_until_show_and_survives_show_hide(app, sandbox):
    """预创建后从未 show：HWND 保持隐藏，但隐藏页可脚本化；首次 show 可输入；快速 show/hide/show 可复用。"""
    paths = [files.write(sandbox.files / "q" / n, n) for n in ("alpha.txt", "beta.txt", "gamma.txt")]
    app.seed(paths)
    time.sleep(1)
    qp = enable_quick(app)
    wait_until(lambda: perf(qp)["loads"], 20, lambda: f"预创建后隐藏页应完成加载：{perf(qp)}")
    assert not is_visible(qp), "预创建后、首次唤出前，快速窗应保持隐藏"
    assert qp.evaluate("() => document.readyState") == "complete"
    first = summon(app, qp)
    assert first and first.get("ms") is not None, first
    assert is_visible(qp)
    assert qp.evaluate("() => document.activeElement?.dataset?.testid") == "quick-input"
    hide(app)
    wait_until(lambda: not is_visible(qp), 3, "收起后应隐藏")
    times = []
    for _ in range(5):
        s = summon(app, qp)
        assert is_visible(qp), "再次唤出应显示"
        assert qp.evaluate("() => document.activeElement?.dataset?.testid") == "quick-input"
        times.append(s["ms"])
        hide(app)
        wait_until(lambda: not is_visible(qp), 3, "循环收起后应隐藏")
    assert len(times) == 5 and all(t >= 0 for t in times), times


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
    card = app.card("项目文档.txt")  # 先取定位器：app.item() 本身会调 get_items
    full_loads = len(app.calls("get_items"))
    inp.press("Control+t")
    tag_inp = qp.get_by_test_id("quick-tag-input")
    tag_inp.wait_for(timeout=3000)
    tag_inp.press_sequentially("快速")
    # §3.3「跨窗一致延迟」：快速窗打标签 → 主窗可见 ≤ CROSS_WINDOW_MS。两页共用墙钟（Date.now），
    # 主窗用 MutationObserver 记下卡片出现新标签的时刻，避免轮询粒度
    app.page.evaluate("""(id) => { window.__tlCross = null; const t = () => {
      const el = document.querySelector(`[data-selectable-item-id="${id}"]`);
      if (el && el.innerText.includes('快速标签')) { window.__tlCross = Date.now(); return true; } return false; };
      const mo = new MutationObserver(() => { if (t()) mo.disconnect(); });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true }); }""", target)
    t0 = qp.evaluate("() => Date.now()")
    tag_inp.press("Enter")
    qp.get_by_test_id("quick-status").filter(has_text="已添加标签「快速标签」").wait_for(timeout=3000)
    wait_until(lambda: "快速标签" in card.inner_text(), 2, lambda: card.inner_text())
    cross_ms = wait_until(lambda: app.page.evaluate("() => window.__tlCross"), 2, "主窗未记录到新标签") - t0
    print(f"QUICK_CROSS_WINDOW tag_visible_in_main_ms={cross_ms}")
    assert cross_ms <= CROSS_WINDOW_MS, f"快速窗打标签后主窗 {cross_ms} ms 才可见，目标 ≤ {CROSS_WINDOW_MS} ms"
    assert len(app.calls("get_items")) == full_loads, "快速窗打标签后主窗应按 ID 增量刷新，而不是整表重载"
    assert app.calls("get_items_by_ids"), "主窗应按对象 ID 取回变化"
    assert [t["id"] for t in app.item("项目文档.txt")["tags"]] == [tag["id"]]
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
    for _ in range(SUMMONS):
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
        # Rust 搜索索引在主进程（主窗首屏后预建，计入 mem_before），单列便于拆分内存构成
        "search_index": app.invoke("search_index_stats"),
        "targets": {"summon_p95": SUMMON_P95_MS, "summon_p99": SUMMON_P99_MS, "query_p95": QUERY_P95_MS[n], "hidden_mb": HIDDEN_MEM_MB[n]},
    }
    (sandbox.artifacts / f"quick-perf-{n}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("QUICK_PERF", json.dumps({k: v for k, v in out.items() if k not in ("processes_after",)}, ensure_ascii=False))

    assert len(query_ms) >= 25, f"输入采样太少：{len(query_ms)}"
    problems = []
    if out["summon_ms"]["p99"] > SUMMON_P99_MS:
        problems.append(f"唤出到可输入 p99 {out['summon_ms']['p99']}ms > {SUMMON_P99_MS}ms")
    if out["summon_ms"]["p95"] > SUMMON_P95_MS:
        problems.append(f"唤出到可输入 p95 {out['summon_ms']['p95']}ms > {SUMMON_P95_MS}ms")
    if out["query_ms"]["p95"] > QUERY_P95_MS[n]:
        problems.append(f"输入到出结果 p95 {out['query_ms']['p95']}ms > {QUERY_P95_MS[n]}ms")
    if hidden_delta > HIDDEN_MEM_MB[n]:
        problems.append(f"隐藏常驻私有内存增量 {hidden_delta}MB > {HIDDEN_MEM_MB[n]}MB")
    assert not problems, "；".join(problems) + f"（详见 quick-perf-{n}.json）"


# ---------------------------------------------------------------- 隐藏后降内存（§3.3）
LOW_AFTER_MS = 2000  # 产品默认 5 分钟；debug 构建经 TAGLAUNCHER_E2E_QUICK_LOW_MS 缩短


def memory_events(qp) -> list[dict]:
    return perf(qp).get("memory", [])


@pytest.mark.case("E-QUICK-MEM-01")
def test_hidden_quick_window_lowers_webview_memory_target(sandbox, app_factory):
    """隐藏超过 N 后 WebView2 MemoryUsageTargetLevel=Low，唤出先恢复 Normal；可见期间、
    提前唤出都不降；降过之后的唤出仍守唤出 p95 ≤ 80 ms。内存变化只记录（Low 只是提示，
    回收多少由 WebView2 决定）。"""
    sandbox.env_extra["TAGLAUNCHER_E2E_QUICK_LOW_MS"] = str(LOW_AFTER_MS)
    build_library(sandbox, 5000)
    app = app_factory()
    app.wait_count(5000, timeout=120)
    pid = app.proc.pid
    qp = enable_quick(app)
    wait_loaded(qp, 5000, timeout=120)

    # 可见期间不降
    summon(app, qp)
    time.sleep(LOW_AFTER_MS / 1000 + 2)
    assert memory_events(qp) == [], f"可见期间不应降内存：{memory_events(qp)}"
    # 隐藏后不到 N 就唤出：旧计时作废
    hide(app)
    time.sleep(LOW_AFTER_MS / 1000 / 2)
    summon(app, qp)
    time.sleep(LOW_AFTER_MS / 1000 + 2)
    assert memory_events(qp) == [], f"隐藏不足 N 就唤出时不应降内存：{memory_events(qp)}"

    cycles, summons = [], []
    for i in range(5):
        hide(app)
        hidden_at = time.time() * 1000
        time.sleep(1)
        before = procmem.tree_memory(pid)
        n0 = len(memory_events(qp))
        low = wait_until(lambda: next((e for e in memory_events(qp)[n0:] if e["level"] == "low"), None),
                         LOW_AFTER_MS / 1000 + 15, lambda: f"隐藏后未降内存：{memory_events(qp)}")
        time.sleep(3)
        after = procmem.tree_memory(pid)
        n1 = len(memory_events(qp))
        s = summon(app, qp)
        normal = wait_until(lambda: next((e for e in memory_events(qp)[n1:] if e["level"] == "normal"), None),
                            5, lambda: f"唤出后未恢复 Normal：{memory_events(qp)}")
        summons.append(s["ms"])
        cycles.append({"low_after_hide_ms": round(low["atMs"] - hidden_at), "normal_before_ready_ms": round(s["readyAtMs"] - normal["atMs"]),
                       "summon_ms": round(s["ms"], 1), "private_mb_before_low": before["private_mb"], "private_mb_low": after["private_mb"],
                       "ws_mb_before_low": before["working_set_mb"], "ws_mb_low": after["working_set_mb"]})
        assert low["atMs"] - hidden_at >= LOW_AFTER_MS - 200, f"第 {i + 1} 轮提前降内存：{cycles[-1]}"
        assert normal["atMs"] <= s["readyAtMs"], f"第 {i + 1} 轮可输入时尚未恢复 Normal：{cycles[-1]}"

    out = {"low_after_ms": LOW_AFTER_MS, "summon_ms": stats(summons), "cycles": cycles,
           "private_mb_delta_median": statistics.median(c["private_mb_low"] - c["private_mb_before_low"] for c in cycles),
           "ws_mb_delta_median": statistics.median(c["ws_mb_low"] - c["ws_mb_before_low"] for c in cycles)}
    (sandbox.artifacts / "quick-memory-level.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("QUICK_MEMORY", json.dumps(out, ensure_ascii=False))
    assert out["summon_ms"]["p95"] <= SUMMON_P95_MS, f"降内存后的唤出 p95 {out['summon_ms']['p95']}ms > {SUMMON_P95_MS}ms：{out}"


@pytest.mark.case("E-QUICK-04")
def test_quick_results_show_icons_for_first_twenty(app, sandbox):
    """快速窗结果：图片对象显示真实缩略图（asset 协议在快速窗可用、图片能解码）；
    超过 20 条时只有前 20 条取图标，其余只画类型图标。"""
    img = files.write(sandbox.files / "qicon" / "图标测试.png", files.png_bytes(16, 16))
    others = [files.write(sandbox.files / "qicon" / f"批量图标{i:02d}.txt", "x") for i in range(29)]
    app.seed([img, *others])
    qp = enable_quick(app)
    wait_loaded(qp, 30)
    summon(app, qp)
    inp = qp.get_by_test_id("quick-input")
    inp.fill("图标")
    # 分帧绘制：首帧 12 行，下一帧补齐。空查询已是 30 条，要用结果列表上的
    # data-query 确认是本词提交后的满列表，避免旧 30 条或首帧 12 条抢先过关。
    wait_until(lambda: qp.evaluate(
        "() => document.querySelector('[data-testid=quick-results]')?.dataset.query === '图标' "
        "&& document.querySelectorAll('[data-testid=quick-result]').length === 30"),
        10, lambda: qp.evaluate(
            "() => ({q: document.querySelector('[data-testid=quick-results]')?.dataset.query, "
            "n: document.querySelectorAll('[data-testid=quick-result]').length})"))
    kinds = qp.eval_on_selector_all("[data-testid=quick-result-icon]", "els => els.map(e => e.dataset.visual)")
    assert kinds[:20] == ["visual"] * 20 and kinds[20:] == ["type"] * 10, kinds
    inp.fill("图标测试")
    wait_until(lambda: qp.get_by_test_id("quick-result").count() == 1, 10)
    loaded = wait_until(lambda: qp.evaluate(
        "() => { const i = document.querySelector('[data-testid=quick-result-icon] img'); return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth : null }"),
        10, lambda: qp.inner_html("[data-testid=quick-results]"))
    assert loaded == 16
    hide(app)


IDLE_WINDOW_S = 120
IDLE_CPU_PCT = 1.0  # §3.3「两窗都隐藏时平均 ≈ 0%」：按单核 1% 计（120 s 内整棵进程树 CPU ≤ 1.2 s）


def _flush_idle_report(app, name: str, payload: dict) -> None:
    """先落盘再抛错，避免先决条件或 reattach 失败时没有 idle JSON。"""
    path = app.sb.artifacts / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def _native_idle_snap(app, tag: str) -> dict:
    """CDP 已断开后经 HWND 采集 FrameId 关联快照；失败记入报告，不重建 CDP。

    落盘目录固定为沙箱 Temp，不用 pytest 进程的 TEMP。
    """
    from harness import idle_diag
    try:
        snap = idle_diag.capture(app.proc.pid, tag, out_dir=app.sb.root / "Temp")
    except Exception as e:  # noqa: BLE001
        snap = {"ok": False, "tag": tag, "error": f"{type(e).__name__}: {e}"}
    snap["assessment"] = idle_diag.assess_snapshot(snap)
    src = snap.get("path")
    if src:
        try:
            import shutil
            dest = app.sb.artifacts / f"idle-native-{tag}.json"
            shutil.copy(src, dest)
            snap["artifact"] = dest.name
        except OSError:
            pass
    return snap


def _require_native_diag(out: dict, key: str) -> None:
    """取证先决：捕获失败则测量无效；映射 UNKNOWN 必须带明确原因，不能当身份证明。"""
    snap = out.get(key) or {}
    assess = snap.get("assessment") or {}
    if assess.get("capture_ok"):
        out.setdefault("native_identity", {})[key] = assess
        return
    out.setdefault("errors", {})[key] = assess.get("reason") or "native diag capture failed"
    raise AssertionError(
        "空闲测量无效：原生诊断取证失败（先决条件，不是产品 CPU 超标；不 skip、不放宽门槛；"
        "未知映射必须写明原因，不能把失败当成身份证明）："
        f"{key}={assess} snap_error={snap.get('error')}"
    )


def measure_idle(app, window_s: float, *, persist_as: str = "idle-measure.json") -> dict:
    """空闲窗口：进程树 CPU（判定口径：单核 ≤ IDLE_CPU_PCT，不变）+ 线程级诊断（窗口两端各一次只读快照：
    每线程 CPU 毫秒、上下文切换≈唤醒次数、线程名）。

    测量窗口内断开 Playwright 的 CDP 连接，结束后重连：用户机器上没有调试会话。对照实验（同一构建）里
    CDP 挂着时，隐藏的快速窗渲染进程仍以约 19 Hz 合成（renderer Compositor ≈2200 次、
    GPU VizCompositorThread ≈2700 次唤醒 / 120s），浏览器主线程也多约 150ms；断开后这两项消失。
    见 DESIGN_ASSERTION_CHANGES.md §17。TL_E2E_IDLE_ATTACHED=1 保持连接（复现 / 对照用）。

    阶段：detach-precondition → idle-measurement → reattach。先写断连报告再采样。
    目标端口连接的零快照只是采样前后两点，不是整段 window_s 无连接的证明。
    reattach 失败不得掩盖已采集的 CPU；阈值与窗口长度不变。
    """
    attached = os.environ.get("TL_E2E_IDLE_ATTACHED") == "1"
    pid = app.proc.pid
    out = {
        "phase": None,
        "cdp_attached": attached,
        "window_s_requested": window_s,
        "errors": {},
        "tcp_zero_is_snapshot_only": True,
    }

    def flush() -> None:
        _flush_idle_report(app, persist_as, out)

    if not attached:
        out["phase"] = "detach-precondition"
        flush()
        try:
            detach = app.detach_cdp()
        except Exception as e:  # noqa: BLE001
            out["errors"]["detach-precondition"] = f"{type(e).__name__}: {e}"
            flush()
            raise AssertionError(
                "空闲测量无效：断连先决条件异常（不是产品 CPU 超标；不 skip、不放宽门槛）："
                f"{out['errors']}"
            ) from e
        out["cdp_detach"] = detach
        out["tcp_before"] = detach.get("survey")
        flush()
        if not detach.get("ok"):
            raise AssertionError(
                "空闲测量无效：CDP 未完全断开（先决条件失败，不是产品 CPU 超标；不 skip、不放宽门槛）："
                f"{detach}"
            )
        # COM 异步采样必须在 CPU 窗口之外；结束快照在 reattach 之前。
        out["native_diag_before"] = _native_idle_snap(app, "before")
        flush()
        _require_native_diag(out, "native_diag_before")
        flush()

    measure_exc: BaseException | None = None
    try:
        out["phase"] = "idle-measurement"
        flush()
        pids0 = [p for p, _ in procmem.tree(pid)]
        th0 = procmem.threads(pids0)
        t0, c0 = time.time(), procmem.tree_cpu(pid)
        time.sleep(window_s)
        t1, c1 = time.time(), procmem.tree_cpu(pid)
        th1 = procmem.threads(pids0)
        tcp_after = None
        if not attached:
            out["native_diag_after"] = _native_idle_snap(app, "after")
            flush()
            try:
                tcp_after = app.survey_target_listeners()
            except Exception as e:  # noqa: BLE001
                tcp_after = {"ok": False, "error": f"{type(e).__name__}: {e}", "n": None}
            out["tcp_after"] = tcp_after
        rows = [{"pid": p, "exe": exe, "cpu_s": round(s - c0[p][1], 3)} for p, (exe, s) in c1.items() if p in c0]
        total = sum(r["cpu_s"] for r in rows)
        role = procmem.roles([r["pid"] for r in rows])  # 采样窗口之后：定位落在哪个 WebView2 子进程
        for r in rows:
            r["role"] = role.get(r["pid"], "?")
        wake: dict[str, int] = {}
        # 合成线程唤醒：渲染进程 Compositor + GPU 进程 VizCompositorThread（页面在出帧时两者同步飙升）
        comp = {"renderer": 0, "gpu": 0}
        for tid, a in th1.items():
            b = th0.get(tid)
            if b and b["pid"] == a["pid"]:
                r = role.get(a["pid"], "?")
                k = f"{r}:{a['pid']}"
                wake[k] = wake.get(k, 0) + a["cs"] - b["cs"]
                if r == "renderer" and a["name"] == "Compositor":
                    comp["renderer"] += a["cs"] - b["cs"]
                elif r == "gpu-process" and a["name"] == "VizCompositorThread":
                    comp["gpu"] += a["cs"] - b["cs"]
        out.update({
            "window_s": round(t1 - t0, 1),
            "cpu_s": round(total, 3),
            "avg_pct_one_core": round(total / (t1 - t0) * 100, 3),
            "processes": sorted(rows, key=lambda r: -r["cpu_s"]),
            "wakeups_by_process": dict(sorted(wake.items(), key=lambda kv: -kv[1])),
            "compositor_wakeups": comp,
            "threads": procmem.thread_delta(th0, th1, role, top=20),
        })
        flush()
        if not attached:
            _require_native_diag(out, "native_diag_after")
        if not attached and tcp_after is not None and (not tcp_after.get("ok") or tcp_after.get("n")):
            out["errors"]["tcp_after"] = (
                "采样结束后目标监听元组连接普查不完整或非零（零快照不是整段窗口证明，"
                "但结束点非零则不能宣称测量窗口内已全部断开）"
            )
            flush()
            raise AssertionError(
                "空闲测量无效：采样结束后目标端口仍有连接或普查不完整（先决条件，不是单凭 CPU 定罪；"
                f"已采 CPU 保留在报告中）：{tcp_after} cpu={out.get('avg_pct_one_core')}"
            )
    except Exception as e:  # noqa: BLE001
        measure_exc = e
        if "idle-measurement" not in out["errors"] and not isinstance(e, AssertionError):
            out["errors"]["idle-measurement"] = f"{type(e).__name__}: {e}"
            flush()
    finally:
        # 禁止在 finally 里抛错，以免掩盖已采集的 CPU 或先决条件错误
        if not attached:
            out["phase"] = "reattach"
            flush()
            try:
                app.reattach_cdp()
            except Exception as e:  # noqa: BLE001
                out["errors"]["reattach"] = f"{type(e).__name__}: {e}"
                flush()

    if measure_exc is not None and not isinstance(measure_exc, AssertionError):
        raise AssertionError(
            f"空闲测量阶段失败（已落盘，reattach 错误保留在报告中）：{out['errors']}"
        ) from measure_exc
    if measure_exc is not None:
        raise measure_exc
    if out["errors"].get("reattach"):
        raise AssertionError(
            "空闲测量已完成，但 reattach 失败（不掩盖已采 CPU；不 skip、不放宽门槛）："
            f"avg_pct_one_core={out.get('avg_pct_one_core')} errors={out['errors']}"
        )
    out["phase"] = "complete"
    flush()
    return out



@pytest.mark.case("E-PERF-IDLE")
def test_idle_cpu_with_both_windows_hidden(app_factory, sandbox):
    """关闭到托盘 + 快速搜索开启（预创建隐藏）：主窗、快速窗都隐藏后，进程树（含 WebView2）
    120 s 平均 CPU ≤ 单核 1%。进程级明细写入 idle-cpu.json。"""
    from win import win32
    build_library(sandbox, 5000)
    app = app_factory()
    app.wait_count(5000, timeout=120)
    app.close_welcome(3000)
    assert app.invoke("set_close_action", {"action": "tray"})["trayActive"]
    qp = enable_quick(app)
    wait_loaded(qp, 5000, timeout=120)
    h = win32.main_window(app.proc.pid, timeout=20, visible=False)
    win32.user32.PostMessageW(h, 0x0010, 0, 0)  # WM_CLOSE → 关闭到托盘（隐藏）
    wait_until(lambda: not win32.is_visible(h), 8, "关闭到托盘应隐藏主窗")
    assert not is_visible(qp)
    time.sleep(10)  # 隐藏后的收尾（GC、索引、data_sync 降频）
    out = measure_idle(app, IDLE_WINDOW_S, persist_as="idle-cpu.json")
    out["target_pct"] = IDLE_CPU_PCT
    pct = out["avg_pct_one_core"]
    (sandbox.artifacts / "idle-cpu.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("IDLE_CPU", json.dumps(out, ensure_ascii=False))
    assert pct <= IDLE_CPU_PCT, f"两窗隐藏时平均 CPU {pct}% > {IDLE_CPU_PCT}%：{out}"


CONSISTENCY_NAMES = ("report-2026.txt", "Report Final.txt", "设计稿.txt", "设计说明.md", "项目文档.txt",
                     "repo-notes.txt", "notes report.txt", "代码 review.txt", "季度报告.txt", "预算表.txt")
# 搜索语义是前缀 / 词首缩写 / 拼音（CJK 才做子串），所以不用 "2026" 这种词中子串
CONSISTENCY_QUERIES = ("rep", "re", "设计", "sj", "notes", "rf", "季度", "报告", "-notes rep")


def main_view_ids(app, query: str, mode: str) -> list[int]:
    args = {"scope": "all", "selectedGroups": [], "excludedGroups": [], "typeFilter": "all", "hideMissing": False,
            "sortMode": "smart", "showNestedContents": False, "libraryBrowseRoot": None, "libraryBrowseDir": None,
            "cabinetDir": None, "cabinetFlat": False, "query": query, "mode": mode, "refreeze": False}
    return app.invoke("view_query", {"args": args})["ids"]


def main_dom_ids(app) -> list[int]:
    return [int(x) for x in app.page.eval_on_selector_all("[data-selectable-item-id]",
                                                          "els => els.map(e => e.dataset.selectableItemId)")]


@pytest.mark.case("E-QUICK-06")
def test_quick_and_main_return_same_ids_in_same_order(app, sandbox):
    """§5 阶段 2 验收：同一份数据和查询，主窗与快速窗结果 ID 序列相同（共享 Rust 索引）。
    界面层：主窗搜索框 vs 快速窗输入框渲染出的顺序；接口层：三种搜索模式下 view_query 与 quick_search。"""
    paths = [files.write(sandbox.files / "same" / n, "x") for n in CONSISTENCY_NAMES]
    app.seed(paths)
    tag = app.invoke("add_tag", {"name": "报告", "color": "#5064d8"})
    for n in ("report-2026.txt", "代码 review.txt"):
        app.invoke("set_item_tags", {"itemId": app.item(n)["id"], "tagIds": [tag["id"]]})
    qp = enable_quick(app)
    wait_loaded(qp, len(paths))
    summon(app, qp)
    inp = qp.get_by_test_id("quick-input")
    report = {}
    for q in CONSISTENCY_QUERIES:
        app.search(q)
        inp.fill(q)
        want = main_view_ids(app, q, "all")
        assert want, f"查询 {q!r} 应有命中"
        wait_until(lambda: main_dom_ids(app) == want, 5, lambda: f"{q!r} 主窗 DOM {main_dom_ids(app)} ≠ view_query {want}")
        wait_until(lambda: result_ids(qp) == want, 5, lambda: f"{q!r} 快速窗 {result_ids(qp)} ≠ 主窗 {want}")
        report[q] = len(want)
        for mode in ("all", "name", "tag"):
            quick = [i["id"]
                     for i in app.invoke("quick_search", {"query": q, "mode": mode, "hideMissing": False, "limit": 50})["items"]]
            assert quick == main_view_ids(app, q, mode)[:50], f"{q!r}/{mode}：快速窗 {quick} ≠ 主窗"
    print(f"QUICK_CONSISTENCY {json.dumps(report, ensure_ascii=False)}")
    app.search("")
    hide(app)
