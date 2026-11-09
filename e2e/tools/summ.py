"""把 results.json 压成短摘要（调试用）。用法：python e2e/tools/summ.py <run-dir> [out.txt]"""
import json
import sys
from pathlib import Path

d = json.loads((Path(sys.argv[1]) / "results.json").read_text(encoding="utf-8"))
lines = []
for t in d["tests"]:
    lines.append(f"== {t['nodeid'].split('::')[-1]} [{','.join(t.get('cases') or [])}] {t['outcome']} {t.get('duration', 0):.1f}s")
    if t["outcome"] not in ("passed",):
        lines.append((t.get("message") or "")[-1500:])
    if t.get("js_errors"):
        lines.append("JS: " + json.dumps(t["js_errors"], ensure_ascii=False)[:600])
lines.append("SUMMARY " + json.dumps(d.get("tests_summary"), ensure_ascii=False))
lines.append("REALDIFF " + json.dumps(d.get("real_dir_diff"), ensure_ascii=False))
out = "\n".join(lines)
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(out, encoding="utf-8")
else:
    print(out)
