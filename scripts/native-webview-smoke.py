#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""原生 WebView2 冒烟：隔离数据目录，不写真实 %LOCALAPPDATA%\\TagLauncher。

用法：
    python scripts/native-webview-smoke.py [--exe PATH] [--count N] [--out JSON]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def capture(page, target: Path) -> None:
    page.evaluate(
        "async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));"
        " await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); }"
    )
    page.screenshot(path=str(target))


def build_fixture(sandbox: Path, count: int) -> Path:
    save = sandbox / "Save"
    files = sandbox / "Files"
    save.mkdir()
    files.mkdir()
    source = (ROOT / "src-tauri/src/db/schema.rs").read_text(encoding="utf-8")
    schema = re.search(r'r#"(.*?)"#', source.split("pub fn create_tables", 1)[1], re.S).group(1)
    conn = sqlite3.connect(save / "taglauncher.db")
    conn.executescript(schema)
    conn.execute("INSERT INTO app_meta(key,value) VALUES ('schema_version','14')")
    for index in range(1, count + 1):
        path = files / f"文件 {index:04}.txt"
        path.write_text(f"native fixture {index}", encoding="utf-8")
        name = "原生搜索唯一目标" if index == 500 else path.name
        conn.execute(
            "INSERT INTO items(id,name,path,type) VALUES (?,?,?,'exe')",
            (index, name, str(path)),
        )
    conn.execute("INSERT INTO tags(id,name,color) VALUES (1,'原生测试','#5064d8')")
    conn.execute("INSERT INTO item_tags(item_id,tag_id,position) VALUES (1,1,0)")
    conn.commit()
    conn.close()
    (sandbox / "datapath.json").write_text(json.dumps({"save_dir": str(save)}), encoding="utf-8")
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="TagLauncher 原生 WebView2 隔离冒烟")
    parser.add_argument(
        "--exe",
        default=str(ROOT / "src-tauri/target/debug/tag-launcher.exe"),
        help="被测二进制",
    )
    parser.add_argument("--count", type=int, default=1000, help="夹具对象数")
    parser.add_argument(
        "--out",
        default=str(ROOT / ".tmp-test/native-perf-result.json"),
        help="结果 JSON",
    )
    parser.add_argument("--keep-sandbox", action="store_true")
    args = parser.parse_args()

    exe_src = Path(args.exe)
    if not exe_src.exists():
        raise SystemExit(f"找不到二进制：{exe_src}")

    sandbox = Path(tempfile.mkdtemp(prefix="native-perf-", dir=str(ROOT / ".tmp-test")))
    print(f"Native sandbox: {sandbox}", flush=True)
    files = build_fixture(sandbox, args.count)
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
    try:
        with (sandbox / "process.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(exe)], cwd=sandbox, env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 45
            endpoint = f"http://127.0.0.1:{port}"
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"native process exited {process.returncode}: {sandbox}")
                try:
                    with urllib.request.urlopen(endpoint + "/json/version", timeout=1):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise RuntimeError(f"WebView2 debugging endpoint unavailable: {sandbox}")
                    time.sleep(0.2)

            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(endpoint)
                deadline = time.monotonic() + 60
                page = None
                while time.monotonic() < deadline:
                    for context in browser.contexts:
                        for candidate in context.pages:
                            url = candidate.url or ""
                            if url and url != "about:blank" and not url.startswith("chrome-error:"):
                                page = candidate
                                break
                        if page:
                            break
                    if page:
                        break
                    time.sleep(0.3)
                if page is None:
                    context = browser.contexts[0] if browser.contexts else None
                    if context is None:
                        raise RuntimeError("WebView2 没有浏览上下文")
                    page = context.pages[0] if context.pages else context.wait_for_event("page")
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                print(f"native page url={page.url}", flush=True)
                page.locator('[data-region="root"]').wait_for(state="attached", timeout=60_000)
                page.wait_for_load_state("networkidle")
                page.evaluate("localStorage.setItem('taglauncher.update_last_check_ts', String(Date.now()))")
                page.locator("[data-selectable-item-id]").first.wait_for()
                buttons = page.get_by_role("button", name="开始使用", exact=True)
                if buttons.count():
                    buttons.click()
                page.wait_for_function(
                    f"() => document.querySelector('[data-region=\"statusbar\"]')?.textContent.includes('{args.count}')"
                )
                start = time.monotonic()
                items = page.evaluate("window.__TAURI__.core.invoke('get_items', {includeVisuals:false})")
                list_ms = (time.monotonic() - start) * 1000
                assert len(items) == args.count and all(not item.get("icon_path") for item in items)
                visual = page.evaluate("window.__TAURI__.core.invoke('get_item_visual', {id:1})")
                assert visual["path"] == str(files / "文件 0001.txt")
                assert Path(visual["icon_path"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
                full = page.evaluate("window.__TAURI__.core.invoke('get_items_by_ids', {ids:[1,2,3]})")
                assert len(full) == 3 and all(item.get("icon_path") for item in full)
                page.locator('[data-selectable-item-id="1"] img').wait_for()
                tag_source = page.locator('[data-region="sidebar-nav"] button').filter(has_text="原生测试").first
                source_box = tag_source.bounding_box()
                target_box = page.locator('[data-selectable-item-id="2"]').bounding_box()
                page.mouse.move(source_box["x"] + 45, source_box["y"] + source_box["height"] / 2)
                page.mouse.down()
                page.mouse.move(target_box["x"] + target_box["width"] / 2, target_box["y"] + 40, steps=18)
                page.mouse.up()
                page.locator('[data-selectable-item-id="2"] span[data-tag-drag]').wait_for()
                tagged = page.evaluate("window.__TAURI__.core.invoke('get_item',{id:2})")
                assert any(tag["name"] == "原生测试" for tag in tagged["tags"])
                page.keyboard.press("F3")
                search_started = time.monotonic()
                page.locator("#workspace-search").fill("唯一目标")
                page.wait_for_function("() => document.querySelectorAll('[data-selectable-item-id]').length===1")
                search_ms = (time.monotonic() - search_started) * 1000
                assert page.locator('[data-selectable-item-id="500"]').count() == 1
                page.locator("#workspace-search").fill("")
                page.locator('[data-selectable-item-id="1"]').wait_for()
                capture(page, sandbox / "workspace.png")
                page.locator('button[aria-label="设置"]').click()
                page.get_by_role("dialog", name="设置工作台").wait_for()
                capture(page, sandbox / "settings.png")
                gallery_mode_matches = page.locator(
                    '[data-theme-family-gallery] [role="radio"][aria-checked="true"] span'
                ).first.evaluate(
                    "el => getComputedStyle(el).backgroundColor === getComputedStyle(document.querySelector('[data-region=main]')).backgroundColor"
                )
                assert gallery_mode_matches
                navigation = page.get_by_role("navigation", name="设置区块导航")
                navigation.get_by_role("button", name="AI 打标", exact=True).click()
                page.get_by_label("API 地址（Base URL）", exact=True).fill("https://native-draft.example/v1")
                navigation.get_by_role("button", name="云同步", exact=True).click()
                navigation.get_by_role("button", name="AI 打标", exact=True).click()
                draft_retained = (
                    page.get_by_label("API 地址（Base URL）", exact=True).input_value()
                    == "https://native-draft.example/v1"
                )
                assert draft_retained
                settings = page.get_by_role("dialog", name="设置工作台")
                close = settings.get_by_role("button", name="关闭", exact=True)
                if close.count() == 0:
                    close = settings.get_by_role("button", name="完成", exact=True)
                close.focus()
                page.keyboard.press("Tab")
                assert page.locator('button[aria-label="关闭设置"]').evaluate("el=>el===document.activeElement")
                capture(page, sandbox / "settings-ai.png")
                page.keyboard.press("Escape")
                page.get_by_role("dialog", name="设置工作台").wait_for(state="detached")
                page.get_by_role("button", name="新建标签", exact=True).click()
                page.get_by_role("dialog", name="新建标签").wait_for()
                page.get_by_role("textbox", name="名称", exact=True).fill("原生界面测试")
                capture(page, sandbox / "tag-editor.png")
                page.keyboard.press("Escape")
                page.locator('[data-selectable-item-id="1"]').click()
                page.keyboard.press("Space")
                page.get_by_role("dialog", name="快速预览").wait_for()
                capture(page, sandbox / "preview.png")
                page.keyboard.press("Escape")
                page.get_by_role("radio", name="暗色", exact=True).click()
                page.wait_for_function("() => document.documentElement.dataset.scheme === 'dark'")
                capture(page, sandbox / "dark.png")
                directory = page.evaluate("window.__TAURI__.core.invoke('get_data_directory_info')")
                result = {
                    "sandbox": str(sandbox),
                    "exe": str(exe_src),
                    "exe_mtime": exe.stat().st_mtime,
                    "count": len(items),
                    "list_ms": list_ms,
                    "search_ms": search_ms,
                    "visual": visual,
                    "default_visuals": len(full),
                    "draft_retained": draft_retained,
                    "native_tag_drag": True,
                    "native_search": True,
                    "gallery_mode_matches": gallery_mode_matches,
                    "settings_focus_wrap": True,
                    "directory": directory,
                    "errors": errors,
                }
                Path(args.out).parent.mkdir(parents=True, exist_ok=True)
                Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(result, ensure_ascii=False), flush=True)
                assert not errors
                browser.close()
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        if not args.keep_sandbox:
            shutil.rmtree(sandbox, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
