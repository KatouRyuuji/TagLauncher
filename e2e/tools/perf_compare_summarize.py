#!/usr/bin/env python3
"""Print a same-runner comparison table from the three measurement directories."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RUNS = [
    ("pr66-4d27d45", "PR66 4d27d45（基线）"),
    ("redesign-19bc707", "redesign 19bc707（当前）"),
    ("redesign-noglazz-19bc707", "19bc707 关毛玻璃"),
]


def load_json(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def cell(value, unit: str = "") -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        text = f"{value:.1f}"
    else:
        text = str(value)
    return f"{text}{unit}"


def delta(cur, base) -> str:
    if cur is None or base is None:
        return "—"
    d = cur - base
    sign = "+" if d > 0 else ""
    return f"{sign}{d:.1f}"


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".tmp-test/e2e/perf-compare")
    rows = []
    for slug, label in RUNS:
        d = root / slug
        quick = load_json(d / "artifacts" / "quick-perf-5000.json")
        pin = load_json(d / "artifacts" / "pin-perf.json")
        meta = load_json(d / "meta.json") if (d / "meta.json").exists() else {}
        q = quick.get("query_ms") or {}
        s = quick.get("summon_ms") or {}
        rows.append({
            "slug": slug,
            "label": label,
            "query_p50": q.get("p50"),
            "query_p95": q.get("p95"),
            "query_p99": q.get("p99"),
            "query_max": q.get("max"),
            "query_n": q.get("n"),
            "summon_p50": s.get("p50"),
            "summon_p95": s.get("p95"),
            "summon_p99": s.get("p99"),
            "hidden_mb": quick.get("hidden_private_mb_delta"),
            "pin_mb": pin.get("resident_private_mb_delta"),
            "slowest": (quick.get("slowest_queries") or [])[:3],
            "pytest_exit": meta.get("pytest_exit"),
            "sha": meta.get("sha_actual"),
            "no_glass": meta.get("no_glass"),
            "exe_sha256": meta.get("exe_sha256"),
            "exe_bytes": meta.get("exe_bytes"),
            "quick": quick,
            "pin": pin,
            "meta": meta,
        })

    base = rows[0]
    print()
    print("======== PERF COMPARE (same Windows job, sequential) ========")
    print(f"artifacts: {root.resolve()}")
    print(f"runner: {(rows[0]['meta'] or {}).get('runner')}  computer: {(rows[0]['meta'] or {}).get('computer')}")
    print()
    headers = ["metric", "budget", *(r["label"] for r in rows), "当前 vs 基线", "关玻璃 vs 基线", "关玻璃 vs 当前"]
    data = [
        ("5k 查询 p50 (ms)", "—", "query_p50"),
        ("5k 查询 p95 (ms)", "≤30", "query_p95"),
        ("5k 查询 p99 (ms)", "—", "query_p99"),
        ("5k 查询 max (ms)", "—", "query_max"),
        ("5k 唤出 p50 (ms)", "—", "summon_p50"),
        ("5k 唤出 p95 (ms)", "≤80", "summon_p95"),
        ("5k 唤出 p99 (ms)", "≤150", "summon_p99"),
        ("快速窗隐藏常驻 ΔMB", "≤60", "hidden_mb"),
        ("钉住 300 项常驻 ΔMB", "≤60", "pin_mb"),
    ]
    # widths
    table = [headers]
    for title, budget, key in data:
        vals = [r[key] for r in rows]
        line = [title, budget, *(cell(v) for v in vals),
                delta(vals[1], vals[0]), delta(vals[2], vals[0]), delta(vals[2], vals[1])]
        table.append(line)
    widths = [max(len(str(row[i])) for row in table) for i in range(len(headers))]
    for i, row in enumerate(table):
        print(" | ".join(str(c).ljust(widths[j]) for j, c in enumerate(row)))
        if i == 0:
            print("-+-".join("-" * w for w in widths))

    print()
    print("slowest 5k queries (top 3 per run):")
    for r in rows:
        print(f"  {r['label']}: {r['slowest']}")
    print()
    print("exe / sha:")
    for r in rows:
        print(f"  {r['slug']}: sha={r['sha']} no_glass={r['no_glass']} pytest_exit={r['pytest_exit']} "
              f"exe={r['exe_bytes']} sha256={r['exe_sha256']}")

    # interpretation hints — facts only, no product change
    q0, q1, q2 = (r["query_p95"] for r in rows)
    print()
    print("reading (for the follow-up, not a product patch by itself):")
    if q0 is not None:
        margin = 30 - q0
        print(f"  - PR66 5k query p95 = {q0} ms, budget 30, margin {margin:+.1f} ms "
              f"({'already tight' if margin < 3 else 'has headroom'}).")
    if None not in (q0, q1):
        print(f"  - redesign vs PR66 5k query p95: {delta(q1, q0)} ms.")
    if None not in (q1, q2):
        glass_cost = q1 - q2
        print(f"  - 毛玻璃 cost on current head (当前 - 关玻璃) 5k query p95: {glass_cost:+.1f} ms.")
        if q2 is not None and q0 is not None:
            rest = q2 - q0
            print(f"  - residual vs PR66 after 关毛玻璃: {rest:+.1f} ms "
                  f"(DOM / highlights / peek / transparency / useLayoutEffect / other).")

    out = {"runs": [{k: v for k, v in r.items() if k not in ("quick", "pin", "meta")} | {"quick": r["quick"], "pin": r["pin"], "meta": r["meta"]} for r in rows]}
    dest = root / "summary.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
