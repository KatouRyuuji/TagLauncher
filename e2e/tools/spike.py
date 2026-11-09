"""Phase-1 spike：验证 IPC 桩注入时机 + 页面侧 tauri://drag-drop 投递（非真实输入部分）。"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from harness.app import AppSession  # noqa: E402
from harness.paths import TMP, default_exe  # noqa: E402
from harness.sandbox import Sandbox  # noqa: E402

out: dict = {}
sb = Sandbox(TMP / "spike" / datetime.now().strftime("%Y%m%d-%H%M%S"), default_exe())
f1 = sb.files / "拖入 A.txt"; f1.write_text("a", encoding="utf-8")
f2 = sb.files / "拖入 B.txt"; f2.write_text("b", encoding="utf-8")
with sync_playwright() as pw:
    app = AppSession(pw, sb)
    t0 = time.monotonic()
    app.start()
    out["startup_s"] = round(time.monotonic() - t0, 2)
    page = app.page
    first_cmds = page.evaluate("window.__e2e.calls.slice(0, 15).map(c => c.cmd)")
    out["first_calls_after_reload"] = first_cmds
    out["stub_before_app_ipc"] = len(first_cmds) > 0 and "get_items" in page.evaluate("window.__e2e.calls.map(c=>c.cmd)")
    out["update_check_stub"] = app.invoke("update_check")
    app.stub("update_check", {"currentVersion": "1.9.0-beta", "latestVersion": "9.9.9", "hasUpdate": True,
                              "releaseUrl": "https://example.invalid/r", "releaseNotes": "n", "installerUrl": "", "installerSize": 0})
    out["update_check_override"] = app.invoke("update_check")["latestVersion"]
    app.stub("plugin:dialog|open", ["C:\\x"])
    out["dialog_stub"] = page.evaluate("window.__TAURI__.core.invoke('plugin:dialog|open', {options: {multiple: true}})")
    out["error_stub"] = None
    app.stub("get_tags", error="桩错误")
    out["error_stub"] = app.invoke_error("get_tags")
    page.evaluate("window.__e2e.unstub('get_tags')")
    out["passthrough_get_tags"] = app.invoke("get_tags")
    # drag-drop：页面侧 emit
    before = len(app.invoke("get_items", {"includeVisuals": False}))
    app.drop_paths([str(f1), str(f2)])
    deadline = time.monotonic() + 8
    after = before
    while time.monotonic() < deadline:
        after = len(app.invoke("get_items", {"includeVisuals": False}))
        if after >= before + 2:
            break
        time.sleep(0.2)
    out["native_drop"] = {"before": before, "after": after}
    time.sleep(0.3)
    out["toasts"] = [t["message"] for t in app.toasts()]
    # DOM 通道
    f3 = sb.files / "拖入 C.txt"; f3.write_text("c", encoding="utf-8")
    app.drop_paths([str(f3)], via="dom")
    time.sleep(1.5)
    out["dom_drop_after"] = len(app.invoke("get_items", {"includeVisuals": False}))
    out["js_errors"] = app.js_errors()
    out["app_data_dir_probe"] = app.invoke("get_data_directory_info")
    code = app.stop()
    out["exit_code"] = code
print(json.dumps(out, ensure_ascii=False, indent=1))
(sb.root / "spike.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
