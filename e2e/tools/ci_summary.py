"""CI 摘要：读逐用例 results.jsonl（取消/超时也在），打印真实统计与失败要点。

用法：python e2e/tools/ci_summary.py <run-dir>
results.json 只在会话正常结束时写出：缺失即说明本次没有跑完，统计只代表已结束的用例。
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path


def load(run_dir: Path) -> tuple[list[dict], bool]:
    lines = run_dir / "results.jsonl"
    recs = []
    if lines.exists():
        for line in lines.read_text(encoding="utf-8").splitlines():
            if line.strip():
                recs.append(json.loads(line))
    return recs, (run_dir / "results.json").exists()


def render(recs: list[dict], complete: bool, max_fail: int = 40) -> str:
    counts = Counter(r.get("outcome") or "unknown" for r in recs)
    out = [f"E2E 用例结束 {len(recs)} 个：" + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())),
           "会话完整结束（results.json 已写出）" if complete else "会话未完整结束：统计仅含已结束用例"]
    bad = [r for r in recs if r.get("outcome") in ("failed", "error", "xpassed")]
    for r in bad[:max_fail]:
        msg = (r.get("message") or "").strip().replace("\r", "")
        out.append(f"\n## {r.get('outcome')} {r.get('nodeid')} ({r.get('duration', 0):.1f}s)\n{msg[-1200:]}")
    if len(bad) > max_fail:
        out.append(f"\n… 另有 {len(bad) - max_fail} 个失败未展开，见 results.jsonl")
    return "\n".join(out)


def main() -> int:
    # Windows runner 控制台默认 cp1252，中文会 UnicodeEncodeError（a245b25 实测）
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".tmp-test/e2e/ci-run")
    recs, complete = load(run_dir)
    text = render(recs, complete)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("```\n" + text[:60000] + "\n```\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
