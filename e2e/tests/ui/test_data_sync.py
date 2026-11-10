"""全局极速阶段①：外部进程（tl CLI）写库后，主窗无需手动刷新即自动反映（E-DS-*）。

延迟口径：tl 进程返回（其事务已提交）→ 主窗 DOM 出现变化（页面内 MutationObserver 记 Date.now()）。
tl 进程退出本身还要几毫秒，因此这是端到端延迟的略微偏小估计；同时记录「从启动 tl 起算」的偏大估计。
目标：每次 ≤ 300 ms（设计：主窗可见时 100 ms 一轮 data_version 检测 + 重载）。
"""
from __future__ import annotations

import ctypes
import json
import statistics
import time
from ctypes import wintypes

import pytest

from harness import files
from harness.app import wait_until
from tests.cli.conftest import Tl

TARGET_MS = 300

_WATCH_JS = """(names) => {
  window.__syncSeen = window.__syncSeen || {};
  const want = new Set(names);
  const scan = () => {
    const now = Date.now();
    document.querySelectorAll('[data-region="root"] h3').forEach((h) => {
      const t = (h.textContent || '').trim();
      if (want.has(t) && !(t in window.__syncSeen)) window.__syncSeen[t] = now;
    });
  };
  if (!window.__syncObs) {
    window.__syncObs = new MutationObserver(scan);
    window.__syncObs.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  window.__syncWant = names;
  scan();
}"""


def _seen(app, name):
    return app.page.evaluate("n => (window.__syncSeen || {})[n] ?? null", name)


@pytest.mark.case("E-DS-01")
def test_tl_add_appears_in_main_window_without_refresh(app, sandbox, cli_path):
    tl = Tl(sandbox, cli_path)
    names = [f"外部新增{i}.txt" for i in range(5)]
    paths = [files.write(sandbox.files / "sync" / n, f"sync-{i}") for i, n in enumerate(names)]
    app.page.evaluate(_WATCH_JS, names)
    time.sleep(0.5)  # 让检测线程处于常态节拍，不与启动期对账写入叠加
    samples = []
    for name, path in zip(names, paths):
        t_start = time.time() * 1000
        tl.run("add", str(path))
        t_exit = time.time() * 1000
        wait_until(lambda: _seen(app, name) is not None, 5, lambda: f"tl add 后 5 秒主窗仍未出现 {name}")
        seen = _seen(app, name)
        samples.append({"name": name, "from_exit_ms": round(seen - t_exit), "from_start_ms": round(seen - t_start)})
        time.sleep(0.25)
    lat = [s["from_exit_ms"] for s in samples]
    report = {"samples": samples, "median_ms": statistics.median(lat), "max_ms": max(lat), "target_ms": TARGET_MS}
    (sandbox.artifacts / "sync-latency.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SYNC_LATENCY", json.dumps(report, ensure_ascii=False))
    assert max(lat) <= TARGET_MS, f"外部写入到主窗反映超过 {TARGET_MS}ms：{report}"
    # 全程未手动刷新：新对象确实由 tl 入库
    assert sorted(n for n in names if any(i["name"] == n for i in app.items())) == sorted(names)


@pytest.mark.case("E-DS-02")
def test_tl_tag_and_remove_reflect_in_main_window(app, sandbox, cli_path):
    tl = Tl(sandbox, cli_path)
    f = files.write(sandbox.files / "sync2" / "打标对象.txt", "x")
    app.seed([f])
    iid = app.item("打标对象.txt")["id"]
    tl.run("tag", "add", "外部标签")
    tl.run("tag", "set", str(iid), "外部标签")
    card = app.card("打标对象.txt")
    wait_until(lambda: "外部标签" in card.inner_text(), 3, lambda: card.inner_text())
    # 侧栏标签列表同步出现
    wait_until(lambda: app.sidebar_tag("外部标签").count() == 1, 3, "侧栏未出现 tl 新建的标签")
    tl.run("remove", str(iid))
    wait_until(lambda: "打标对象.txt" not in app.visible_names(), 3, lambda: app.visible_names())


# ---- 空闲 CPU：检测是低频 PRAGMA，不应让主进程空转 ----
class _FILETIME(ctypes.Structure):
    _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]


def _cpu_seconds(pid: int) -> float:
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    assert h, f"OpenProcess 失败：{ctypes.get_last_error()}"
    try:
        c, e, kt, ut = _FILETIME(), _FILETIME(), _FILETIME(), _FILETIME()
        assert k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(kt), ctypes.byref(ut))
        to_s = lambda ft: ((ft.hi << 32) | ft.lo) / 1e7
        return to_s(kt) + to_s(ut)
    finally:
        k32.CloseHandle(h)


@pytest.mark.case("E-DS-03")
def test_idle_main_process_cpu_near_zero(app, sandbox):
    time.sleep(3)  # 启动期对账/预热结束
    pid = app.proc.pid
    c0, t0 = _cpu_seconds(pid), time.monotonic()
    time.sleep(10)
    c1, t1 = _cpu_seconds(pid), time.monotonic()
    pct = (c1 - c0) / (t1 - t0) * 100
    (sandbox.artifacts / "idle-cpu.json").write_text(json.dumps({"cpu_pct_one_core": round(pct, 3), "cpu_s": round(c1 - c0, 4), "window_s": round(t1 - t0, 2)}), encoding="utf-8")
    print("IDLE_CPU_PCT", round(pct, 3))
    assert pct < 1.0, f"空闲 10 秒主进程 CPU {pct:.2f}%（单核），检测线程不应空转"
