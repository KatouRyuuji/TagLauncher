"""开发辅助：启动带夹具的沙箱，导出各主要界面的 aria 快照，便于写选择器。"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from harness import files  # noqa: E402
from harness.app import AppSession  # noqa: E402
from harness.paths import TMP, default_exe  # noqa: E402
from harness.sandbox import Sandbox  # noqa: E402

steps = sys.argv[1:] or ["main", "ctx", "add", "palette", "settings"]
sb = Sandbox(TMP / "explore" / datetime.now().strftime("%Y%m%d-%H%M%S"), default_exe())
zoo = files.type_zoo(sb.files / "zoo")
out = sb.root / "explore.txt"
buf: list[str] = []


def dump(title: str, loc) -> None:
    try:
        snap = loc.aria_snapshot(timeout=5000)
    except Exception as e:  # noqa: BLE001
        snap = f"<err {e}>"
    buf.append(f"\n===== {title} =====\n{snap}")


def run(app, p):

    time.sleep(1.5)
    dump("welcome/body", p.locator("body"))
    app.close_welcome()
    dump("empty main", p.locator("body"))
    res = app.invoke("add_items", {"paths": [str(v) for v in zoo.values()]})
    buf.append("add_items => " + json.dumps(res, ensure_ascii=False)[:600])
    app.refresh_items()
    time.sleep(1.5)
    regions = p.evaluate("[...document.querySelectorAll('[data-region]')].map(e => e.dataset.region)")
    buf.append("regions: " + ", ".join(regions))
    dump("main", p.locator("body"))
    card = p.locator("[data-selectable-item-id]").first
    buf.append("card html: " + p.evaluate("e => e.outerHTML.slice(0, 2500)", card.element_handle()))
    buf.append("card attrs: " + json.dumps(p.evaluate(
        "[...document.querySelectorAll('[data-selectable-item-id]')].slice(0,3).map(e => [...e.attributes].map(a => a.name + '=' + a.value.slice(0,40)))"), ensure_ascii=False))
    card.click(button="right")
    time.sleep(0.4)
    dump("context menu", p.locator("body"))
    p.keyboard.press("Escape")
    time.sleep(0.3)
    try:
        p.get_by_role("button", name="添加").first.click(timeout=3000)
        time.sleep(0.4)
        dump("add menu", p.locator("body"))
        p.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        buf.append(f"add btn err {e}")
    p.keyboard.press("Control+k")
    time.sleep(0.4)
    dump("palette", p.locator("body"))
    p.keyboard.press("Escape")
    time.sleep(0.3)
    p.keyboard.press("Control+Comma")
    time.sleep(0.8)
    dump("settings", p.locator("body"))
    navs = p.locator('[role="dialog"] nav button, [role="dialog"] [role="tab"]').all_inner_texts()
    buf.append("settings navs: " + json.dumps(navs, ensure_ascii=False))
    for name in navs[:12]:
        try:
            p.locator('[role="dialog"]').get_by_role("button", name=name.strip(), exact=True).first.click(timeout=2000)
            time.sleep(0.5)
            dump("settings/" + name.strip(), p.locator('[role="dialog"]').last)
        except Exception as e:  # noqa: BLE001
            buf.append(f"nav {name} err {e}")


with sync_playwright() as pw:
    app = AppSession(pw, sb, dismiss_welcome=False)
    app.start()
    p = app.page
    try:
        run(app, p)
    finally:
        out.write_text("\n".join(buf), encoding="utf-8")
        app.stop()
print(out)
