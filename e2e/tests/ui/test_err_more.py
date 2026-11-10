"""错误与空态补充（E-ERR-02/03/05）。"""
from __future__ import annotations

import os
import subprocess
import time

import pytest

from harness import files
from harness.app import wait_until

INJECT = "E2E注入错误"


def stub_raw(app, cmd, spec):
    app.page.evaluate("([c, s]) => window.__e2e.stub(c, s)", [cmd, spec])


@pytest.mark.expected_js_errors
@pytest.mark.case("E-ERR-02")
def test_list_load_failure_and_retry(app):
    stub_raw(app, "view_query", {"queue": [{"error": INJECT + "：列表"}, {"passthrough": True}]})
    app.refresh_items()
    panel = app.page.get_by_role("heading", name="对象列表加载失败")
    panel.wait_for(timeout=8000)
    app.page.get_by_role("button", name="重试").click()
    panel.wait_for(state="detached", timeout=8000)
    assert app.proc.poll() is None


def _new_toasts(app, before):
    return [t for t in app.toasts()[before:] if t.get("message")]


ACTIONS = {
    "launch_item": lambda app: app.menu_click("错误样本.txt", "打开"),
    "toggle_favorite": lambda app: app.menu_click("错误样本.txt", "加入收藏"),
    "open_in_explorer_by_id": lambda app: app.menu_click("错误样本.txt", "打开所在文件夹"),
    "backup_data": lambda app: app.open_settings("数据管理").get_by_role("button", name="一键备份").click(),
    "export_data": lambda app: app.open_settings("数据管理").get_by_role("button", name="导出数据").click(),
    "set_folder_watch_master": lambda app: app.open_settings("数据管理").get_by_role("switch", name="允许文件夹监视").click(),
    "sync_backup_now": None,  # 需配置 WebDAV，已由 E-SYNC-07 失败 toast 覆盖
}


@pytest.mark.case("E-ERR-03")
@pytest.mark.parametrize("cmd", [k for k, v in ACTIONS.items() if v])
def test_backend_error_toast(app, sandbox, cmd):
    p = files.write(sandbox.files / "err" / "错误样本.txt", "e")
    app.seed([p])
    # 兜底：任何可能真开外部窗口/原生对话框的命令都桩掉
    app.stub("plugin:dialog|save", str(sandbox.files / "export.json"))
    for c in ("open_in_explorer", "open_in_explorer_by_id"):
        app.stub(c, error=INJECT + "：" + c)
    app.stub(cmd, error=INJECT + "：" + cmd)
    before = len(app.toasts())
    ACTIONS[cmd](app)
    wait_until(lambda: _new_toasts(app, before), 8, f"{cmd} 注入错误后无 toast")
    msgs = [t["message"] for t in _new_toasts(app, before)]
    assert any(t.get("type") == "error" for t in _new_toasts(app, before)), msgs
    assert not any("undefined" in m or "[object" in m for m in msgs), msgs
    assert app.js_errors() == [], app.js_errors()
    assert app.proc.poll() is None


@pytest.mark.case("E-ERR-05")
def test_readonly_backup_dir(app, sandbox):
    bk = sandbox.default_save_dir / "Backups"
    bk.mkdir(parents=True, exist_ok=True)
    user = os.environ.get("USERNAME", "")
    deny = ["icacls", str(bk), "/deny", f"{user}:(OI)(CI)(W,AD,WD)"]
    undo = ["icacls", str(bk), "/remove:d", user]
    assert str(bk).lower().startswith(str(sandbox.root).lower())  # 只改沙箱目录 ACL
    subprocess.run(deny, check=True, capture_output=True)
    try:
        before = len(app.toasts())
        app.open_settings("数据管理").get_by_role("button", name="一键备份").click()
        wait_until(lambda: _new_toasts(app, before), 10, "只读目录备份无提示")
        msgs = [t["message"] for t in _new_toasts(app, before)]
        assert any(("失败" in m or "无法" in m) for m in msgs), msgs
        assert app.proc.poll() is None
    finally:
        subprocess.run(undo, capture_output=True)
    time.sleep(0.2)
