"""结果收集：results.json + report.html（不依赖 pytest-html），并按用例矩阵汇总覆盖。"""
from __future__ import annotations

import html
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import pytest

from .paths import E2E

LAYER_BY_DIR = {"cli": "CLI", "ui": "UI", "visual": "视觉", "window": "窗口"}
RANK = {"failed": 5, "error": 5, "xpassed": 4, "xfailed": 3, "passed": 2, "skipped": 1}


def load_cases() -> list[dict]:
    return json.loads((E2E / "cases.json").read_text(encoding="utf-8"))


class Reporter:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.results: dict[str, dict] = {}
        self.session_notes: list[str] = []
        self.started = time.time()
        self.real_dir_diff: dict[str, str] | None = None

    # ---------------------------------------------------------------- hooks
    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_makereport(self, item, call):
        outcome = yield
        rep = outcome.get_result()
        rec = self.results.setdefault(item.nodeid, {
            "nodeid": item.nodeid,
            "cases": [a for m in item.iter_markers("case") for a in m.args],
            "layer": layer_of(item),
            "outcome": None, "duration": 0.0, "message": "", "artifacts": [], "js_errors": [],
        })
        rec["duration"] += rep.duration
        status = None
        if hasattr(rep, "wasxfail"):
            status = "xfailed" if rep.skipped else "xpassed"
            rec["message"] = rep.wasxfail
        elif rep.failed:
            status = "failed" if rep.when == "call" else "error"
            rec["message"] = str(rep.longreprtext)[-6000:]
        elif rep.skipped:
            status = "skipped"
            rec["message"] = rep.longrepr[2] if isinstance(rep.longrepr, tuple) else str(rep.longrepr)
        elif rep.when == "call":
            status = "passed"
        if status and (rec["outcome"] is None or RANK[status] >= RANK[rec["outcome"]]):
            rec["outcome"] = status
        for name, value in item.user_properties:
            if name == "artifact" and value not in rec["artifacts"]:
                rec["artifacts"].append(value)
            if name == "js_errors":
                rec["js_errors"] = value

    def pytest_sessionfinish(self, session, exitstatus):
        self.write()

    # ---------------------------------------------------------------- output
    def coverage(self) -> list[dict]:
        by_case: dict[str, list[dict]] = defaultdict(list)
        for r in self.results.values():
            for c in r["cases"]:
                by_case[c].append(r)
        rows = []
        for c in load_cases():
            tests = by_case.get(c["id"], [])
            if tests:
                status = max((t["outcome"] or "skipped" for t in tests), key=lambda s: RANK[s])
            else:
                status = "未实现"
            rows.append({**c, "status": status, "tests": [t["nodeid"] for t in tests]})
        return rows

    def write(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        cov = self.coverage()
        summary = defaultdict(Counter)
        for row in cov:
            summary[f"{row['layer']}/{row['priority']}"][row["status"]] += 1
        tests_summary = Counter(r["outcome"] for r in self.results.values())
        data = {
            "started": self.started, "finished": time.time(),
            "tests": list(self.results.values()), "tests_summary": tests_summary,
            "coverage": cov, "coverage_summary": {k: dict(v) for k, v in sorted(summary.items())},
            "real_dir_diff": self.real_dir_diff, "notes": self.session_notes,
        }
        (self.run_dir / "results.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        (self.run_dir / "report.html").write_text(render_html(data), encoding="utf-8")


def layer_of(item) -> str:
    parts = Path(str(item.fspath)).parts
    for key, name in LAYER_BY_DIR.items():
        if key in parts:
            return name
    return "?"


def render_html(data: dict) -> str:
    color = {"passed": "#2e7d32", "failed": "#c62828", "error": "#c62828", "xfailed": "#ef6c00",
             "xpassed": "#6a1b9a", "skipped": "#757575", "未实现": "#9e9e9e"}
    esc = html.escape
    rows = []
    for t in sorted(data["tests"], key=lambda r: r["nodeid"]):
        arts = " ".join(f'<a href="{esc(Path(a).resolve().as_uri())}">{esc(Path(a).name)}</a>' for a in t["artifacts"])
        rows.append(
            f'<tr><td style="color:{color.get(t["outcome"], "#000")}">{esc(str(t["outcome"]))}</td>'
            f'<td>{esc(t["layer"])}</td><td>{esc(", ".join(t["cases"]))}</td><td>{esc(t["nodeid"])}</td>'
            f'<td>{t["duration"]:.1f}s</td><td><details><summary>详情</summary><pre>{esc(t["message"])}</pre>'
            f'{"<pre>JS: " + esc(json.dumps(t["js_errors"], ensure_ascii=False)) + "</pre>" if t["js_errors"] else ""}'
            f'</details>{arts}</td></tr>')
    cov_rows = "".join(
        f'<tr><td>{esc(k)}</td>' + "".join(f"<td>{v.get(s, 0)}</td>" for s in
                                           ("passed", "failed", "error", "xfailed", "skipped", "未实现")) + "</tr>"
        for k, v in data["coverage_summary"].items())
    matrix = "".join(
        f'<tr><td>{esc(c["id"])}</td><td>{esc(c["priority"])}</td><td>{esc(c["layer"])}</td><td>{esc(c["scenario"])}</td>'
        f'<td style="color:{color.get(c["status"], "#000")}">{esc(c["status"])}</td></tr>' for c in data["coverage"])
    diff = data["real_dir_diff"]
    return f"""<!doctype html><meta charset="utf-8"><title>TagLauncher E2E</title>
<style>body{{font:13px system-ui,"Microsoft YaHei"}} table{{border-collapse:collapse}} td,th{{border:1px solid #ddd;padding:3px 6px;vertical-align:top}} pre{{white-space:pre-wrap;max-width:900px}}</style>
<h1>TagLauncher E2E 报告</h1>
<p>用例结果：{esc(json.dumps(data["tests_summary"], ensure_ascii=False))}</p>
<p>真实目录比对（E-ENV-14 会话终检）：{"零变化" if diff == {} else esc(json.dumps(diff, ensure_ascii=False)) if diff else "未执行"}</p>
<h2>矩阵覆盖（层/优先级）</h2><table><tr><th></th><th>通过</th><th>失败</th><th>错误</th><th>xfail</th><th>跳过</th><th>未实现</th></tr>{cov_rows}</table>
<h2>测试</h2><table><tr><th>结果</th><th>层</th><th>用例</th><th>节点</th><th>耗时</th><th>详情</th></tr>{"".join(rows)}</table>
<h2>矩阵</h2><table>{matrix}</table>"""
