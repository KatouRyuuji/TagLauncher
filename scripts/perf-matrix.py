#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TagLauncher 性能矩阵：1k/10k/50k 三档 × 六项指标，真实 WebView2（隔离沙箱）。

用法：
    python scripts/perf-matrix.py [--exe PATH] [--counts 1000,10000,50000]
        [--repeat 5] [--rows-only] [--baseline REPORT.json] [--keep-sandbox] [--out DIR]

基线对比：--baseline 载入旧报告，任一指标中位数退化 >15% 判回归（退出码 1）。
报告：.tmp-test/perf/<git-sha>/report.json + 控制台表格。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import socket
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 复用 smoke 的沙箱/exe 拷贝/CDP 连接流程（只读导入，不改动原脚本）
_spec = importlib.util.spec_from_file_location("native_smoke", ROOT / "scripts/native-webview-smoke.py")
_smoke = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_smoke)

TYPE_CYCLE = ["exe", "exe", "folder", "image", "exe", "audio", "video", "exe", "bat", "ps1"]
CN_WORDS = ["开发环境", "项目文档", "设计稿", "配置文件", "数据备份", "截图素材", "会议纪要", "发布脚本", "测试报告", "素材库"]
TAG_NAMES = ["工作", "开发", "娱乐", "音乐", "电影", "照片", "文档", "工具", "收藏", "学习",
             "游戏", "图片", "视频", "音频", "脚本", "项目", "归档", "临时", "重要", "参考"]

THRESHOLDS = {
    # 指标: {count: 上限 ms（release exe 建议回归阈值）}
    "startup_tti_ms": {1000: 2000, 10000: 3000, 50000: 8000},
    "list_ms_warm": {1000: 50, 10000: 300, 50000: 1500},
    "search_hot_ms": {1000: 200, 10000: 250, 50000: 600},
    "search_cold_ms": {1000: 300, 10000: 800, 50000: 4000},
    # 主题切换 = 点击→scheme 翻转+两帧：含 240ms 设计过渡与色位补丁重排（与库规模无关），
    # 阈值按 600ms 记录线；回归对比仍走 baseline >15%
    "theme_switch_ms": {1000: 600, 10000: 600, 50000: 600},
}


def git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        return "unknown"


def build_fixture_bulk(sandbox: Path, count: int, rows_only: bool) -> None:
    """合成数据夹具：类型/中文名/标签/收藏/失效按真实混合分布，单事务批量写入。"""
    save = sandbox / "Save"
    files = sandbox / "Files"
    save.mkdir()
    files.mkdir()
    source = (ROOT / "src-tauri/src/db/schema.rs").read_text(encoding="utf-8")
    schema = re.search(r'r#"(.*?)"#', source.split("pub fn create_tables", 1)[1], re.S).group(1)
    conn = sqlite3.connect(save / "taglauncher.db")
    conn.executescript(schema)
    conn.execute("INSERT INTO app_meta(key,value) VALUES ('schema_version','14')")

    items = []
    item_tags = []
    for index in range(1, count + 1):
        itype = TYPE_CYCLE[index % len(TYPE_CYCLE)]
        if index == 500:
            name = "原生搜索唯一目标"
        elif index % 20 == 0:
            name = f"{CN_WORDS[index % len(CN_WORDS)]}-{index:05}"
        elif index % 7 == 0:
            name = f"Photo_{index:05}"
        else:
            name = f"文件 {index:05}"
        ext = {"folder": "", "image": ".jpg", "audio": ".mp3", "video": ".mp4",
               "exe": ".exe", "bat": ".bat", "ps1": ".ps1"}[itype]
        path = str(files / f"{name}{ext}")
        if not rows_only and itype != "folder":
            Path(path).write_text(f"perf fixture {index}", encoding="utf-8")
        elif not rows_only:
            Path(path).mkdir(exist_ok=True)
        favorite = 1 if index % 25 == 0 else 0
        missing = 1 if index % 100 == 0 else 0
        # last_used_at 按近 30 天衰减分布（ISO 串，SQLite DATETIME 文本比较）
        last_used = f"2026-09-{1 + index % 20:02d} {10 + index % 12:02d}:30:00" if index % 3 else None
        items.append((index, name, path, itype, favorite, missing, last_used))
        if index % 5 == 0:
            item_tags.append((index, 1 + index % len(TAG_NAMES), 0))
        if index % 17 == 0:
            second = 1 + (index * 7) % len(TAG_NAMES)
            # UNIQUE(item_id, tag_id)：与主标签撞号时跳过
            if not (index % 5 == 0 and second == 1 + index % len(TAG_NAMES)):
                item_tags.append((index, second, 1))

    conn.executemany(
        "INSERT INTO items(id,name,path,type,is_favorite,is_missing,last_used_at) VALUES (?,?,?,?,?,?,?)",
        items,
    )
    conn.executemany(
        "INSERT INTO tags(id,name,color) VALUES (?,?,'#5064d8')",
        [(i + 1, tag) for i, tag in enumerate(TAG_NAMES)],
    )
    conn.executemany("INSERT INTO item_tags(item_id,tag_id,position) VALUES (?,?,?)", item_tags)
    conn.commit()
    conn.close()
    (sandbox / "datapath.json").write_text(json.dumps({"save_dir": str(save)}), encoding="utf-8")


RAF_PROBE_JS = """
async (durationMs) => {
  const scroller = document.querySelector('[data-region="main"] [data-virtual-scroller]')
    || document.querySelector('[data-region="main"] .overflow-y-auto')
    || document.scrollingElement;
  const frames = [];
  let last = performance.now();
  let running = true;
  function tick(now) {
    frames.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  const step = Math.max(200, Math.floor(scroller.clientHeight * 0.8));
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
    await new Promise(r => setTimeout(r, 16));
  }
  running = false;
  frames.shift();
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const jank = frames.filter(f => f > 50).length / Math.max(1, frames.length) * 100;
  return { avgFps: Math.round(1000 / Math.max(1, avg)), p95FrameMs: Math.round(p95 * 10) / 10, jankPct: Math.round(jank * 10) / 10, frames: frames.length };
}
"""


def measure_once(exe_src: Path, count: int, rows_only: bool, keep_sandbox: bool) -> dict:
    sandbox = Path(tempfile.mkdtemp(prefix=f"perf-{count}-", dir=str(ROOT / ".tmp-test")))
    try:
        build_fixture_bulk(sandbox, count, rows_only)
        exe = sandbox / "tag-launcher.exe"
        shutil.copy2(exe_src, exe)

        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = dict(os.environ)
        env["LOCALAPPDATA"] = str(sandbox / "LocalAppData")
        env["WEBVIEW2_USER_DATA_FOLDER"] = str(sandbox / "WebView2")
        env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={port}"

        process = None
        endpoint = f"http://127.0.0.1:{port}"
        try:
            with (sandbox / "process.log").open("w", encoding="utf-8") as log:
                t_spawn = time.monotonic()
                process = subprocess.Popen([str(exe)], cwd=sandbox, env=env, stdout=log, stderr=log)
                deadline = time.monotonic() + 45
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f"进程提前退出 {process.returncode}: {sandbox}")
                    try:
                        with urllib.request.urlopen(endpoint + "/json/version", timeout=1):
                            break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise RuntimeError(f"CDP 端点不可用: {sandbox}")
                        time.sleep(0.2)

            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.connect_over_cdp(endpoint)
                page = None
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    for context in browser.contexts:
                        for candidate in context.pages:
                            if candidate.url and candidate.url != "about:blank" and not candidate.url.startswith("chrome-error:"):
                                page = candidate
                                break
                        if page:
                            break
                    if page:
                        break
                    time.sleep(0.3)
                if page is None:
                    raise RuntimeError("WebView2 页面未出现")
                errors: list[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))

                # ① 启动到可交互：首张卡 attached + 状态栏计数正确
                page.locator('[data-region="root"]').wait_for(state="attached", timeout=60_000)
                page.evaluate("localStorage.setItem('taglauncher.update_last_check_ts', String(Date.now()))")
                page.locator("[data-selectable-item-id]").first.wait_for(timeout=60_000)
                welcome = page.get_by_role("button", name="开始使用", exact=True)
                if welcome.count():
                    welcome.click()
                page.wait_for_function(
                    f"() => document.querySelector('[data-region=\"statusbar\"]')?.textContent.includes('{count}')",
                    timeout=60_000,
                )
                startup_tti_ms = (time.monotonic() - t_spawn) * 1000

                # ② get_items IPC：一律页内计时（payload 经 CDP 回传 Python 会产生
                # 秒级测量伪差，50k ≈ 17MB）；对象数校验单独取一次且不计时
                list_ms_cold = page.evaluate(
                    "async () => { const t = performance.now();"
                    " await window.__TAURI__.core.invoke('get_items', {includeVisuals:false});"
                    " return performance.now() - t; }"
                )
                items = page.evaluate("window.__TAURI__.core.invoke('get_items', {includeVisuals:false})")
                assert len(items) == count
                t = time.monotonic()
                page.evaluate("window.__TAURI__.core.invoke('reconcile_items', {force:true, wait:true})")
                reconcile_ms = (time.monotonic() - t) * 1000
                warm = []
                for _ in range(5):
                    ms = page.evaluate(
                        "async () => { const t = performance.now();"
                        " await window.__TAURI__.core.invoke('get_items', {includeVisuals:false});"
                        " return performance.now() - t; }"
                    )
                    warm.append(ms)
                list_ms_warm = statistics.median(warm)

                # ③ 搜索：冷（单 CJK 字触发索引构建）/ 热（中位数，含 150ms 防抖）
                page.keyboard.press("F3")
                t = time.monotonic()
                page.locator("#workspace-search").fill("唯")
                page.wait_for_function("() => document.querySelectorAll('[data-selectable-item-id]').length===1", timeout=30_000)
                search_cold_ms = (time.monotonic() - t) * 1000
                hot = []
                for query in ["唯一目标", "Photo", "开发环境"]:
                    t = time.monotonic()
                    page.locator("#workspace-search").fill(query)
                    page.wait_for_function(
                        "() => !document.querySelector('[data-region=\"statusbar\"]')?.textContent.includes('搜索中')",
                        timeout=30_000,
                    )
                    hot.append((time.monotonic() - t) * 1000)
                search_hot_ms = statistics.median(hot)
                page.locator("#workspace-search").fill("")

                # ④ 滚动帧率探针（程序式 scrollTop 走全表）
                scroll = page.evaluate(RAF_PROBE_JS, 3000)

                # ⑤ 主题切换：点暗色 radio → scheme 翻转 + 两帧落定
                t = time.monotonic()
                page.locator("#sidebar-theme-mode-dark").click()
                page.wait_for_function("() => document.documentElement.dataset.scheme === 'dark'", timeout=10_000)
                page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                theme_switch_ms = (time.monotonic() - t) * 1000

                browser.close()
                return {
                    "startup_tti_ms": round(startup_tti_ms, 1),
                    "list_ms_cold": round(list_ms_cold, 1),
                    "list_ms_warm": round(list_ms_warm, 1),
                    "reconcile_ms": round(reconcile_ms, 1),
                    "search_cold_ms": round(search_cold_ms, 1),
                    "search_hot_ms": round(search_hot_ms, 1),
                    "scroll": scroll,
                    "theme_switch_ms": round(theme_switch_ms, 1),
                    "errors": errors,
                }
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
    finally:
        if not keep_sandbox:
            shutil.rmtree(sandbox, ignore_errors=True)


def median_run(runs: list[dict]) -> dict:
    out = {}
    for key in ["startup_tti_ms", "list_ms_cold", "list_ms_warm", "reconcile_ms", "search_cold_ms", "search_hot_ms", "theme_switch_ms"]:
        out[key] = round(statistics.median(r[key] for r in runs), 1)
    out["scroll"] = {
        "avgFps": round(statistics.median(r["scroll"]["avgFps"] for r in runs)),
        "p95FrameMs": round(statistics.median(r["scroll"]["p95FrameMs"] for r in runs), 1),
        "jankPct": round(statistics.median(r["scroll"]["jankPct"] for r in runs), 1),
    }
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="TagLauncher 性能矩阵")
    parser.add_argument("--exe", default=str(ROOT / "src-tauri/target/release/tag-launcher.exe"))
    parser.add_argument("--counts", default="1000,10000,50000")
    parser.add_argument("--repeat", type=int, default=5)
    parser.add_argument("--rows-only", action="store_true", help="夹具只建行不建文件（50k 推荐）")
    parser.add_argument("--baseline", default=None, help="旧报告路径，退化 >15% 判回归")
    parser.add_argument("--keep-sandbox", action="store_true")
    parser.add_argument("--out", default=None, help="报告输出目录（默认 .tmp-test/perf/<sha>）")
    args = parser.parse_args()

    exe_src = Path(args.exe)
    if not exe_src.exists():
        raise SystemExit(f"找不到二进制：{exe_src}")
    counts = [int(part) for part in args.counts.split(",") if part.strip()]
    out_dir = Path(args.out) if args.out else ROOT / ".tmp-test/perf" / git_sha()
    out_dir.mkdir(parents=True, exist_ok=True)

    runs = []
    for count in counts:
        rows_only = args.rows_only or count >= 50000
        print(f"\n=== {count} 项 × {args.repeat} 次（rows_only={rows_only}）===", flush=True)
        samples = []
        for attempt in range(args.repeat):
            print(f"  run {attempt + 1}/{args.repeat} …", flush=True)
            samples.append(measure_once(exe_src, count, rows_only, args.keep_sandbox))
            print(f"    tti={samples[-1]['startup_tti_ms']:.0f} list_warm={samples[-1]['list_ms_warm']:.1f} "
                  f"hot={samples[-1]['search_hot_ms']:.0f} theme={samples[-1]['theme_switch_ms']:.0f} "
                  f"fps={samples[-1]['scroll']['avgFps']}", flush=True)
        runs.append({"count": count, "rows_only": rows_only, "samples": samples, "median": median_run(samples)})

    report = {
        "commit": git_sha(),
        "exe": {"path": str(exe_src), "mtime": exe_src.stat().st_mtime},
        "env": {"os": sys.platform, "machine": os.environ.get("COMPUTERNAME", "")},
        "runs": runs,
    }

    regressions: list[str] = []
    threshold_breaches: list[str] = []
    if args.baseline:
        base = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
        base_by_count = {r["count"]: r["median"] for r in base.get("runs", [])}
        diffs = []
        for run in runs:
            old = base_by_count.get(run["count"])
            if not old:
                continue
            for key in ["startup_tti_ms", "list_ms_cold", "list_ms_warm", "reconcile_ms", "search_cold_ms", "search_hot_ms", "theme_switch_ms"]:
                if key not in old:
                    continue
                delta = (run["median"][key] - old[key]) / max(old[key], 1e-6) * 100
                diffs.append(f"{run['count']}/{key}: {old[key]:.1f} → {run['median'][key]:.1f} ({delta:+.0f}%)")
                if delta > 15:
                    regressions.append(f"{run['count']}/{key} 退化 {delta:+.0f}%")
        report["baseline_diff"] = diffs

    # 控制台表格
    print("\n指标                    | " + " | ".join(f"{c:>10}" for c in counts))
    for key in ["startup_tti_ms", "list_ms_cold", "list_ms_warm", "reconcile_ms", "search_cold_ms", "search_hot_ms", "theme_switch_ms"]:
        row = f"{key:<22} | "
        cells = []
        for run in runs:
            value = run["median"][key]
            limit = THRESHOLDS.get(key, {}).get(run["count"])
            mark = " !" if limit and value > limit else ""
            if limit and value > limit:
                threshold_breaches.append(f"{run['count']}/{key} {value:.1f} > {limit}")
            cells.append(f"{value:>9.1f}{mark:<2}")
        print(row + " | ".join(cells))
    print(f"{'scroll avgFps/jank%':<22} | " + " | ".join(
        f"{r['median']['scroll']['avgFps']:>4}/{r['median']['scroll']['jankPct']:>5}" for r in runs))
    if "baseline_diff" in report:
        print("\n基线对比：")
        for line in report["baseline_diff"]:
            print(f"  {line}")

    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告 → {out_dir / 'report.json'}")
    if regressions:
        print("回归：" + "；".join(regressions))
        return 1
    if threshold_breaches:
        print("超阈值：" + "；".join(threshold_breaches))
        # 超阈值只警告：阈值是目标不是硬门（ debug/机器差异大）
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
