"""环境与启动 P1/P2（E-ENV-02/03/11/12）。原生弹窗/窗口类见 tests/window。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def welcome(app):
    return app.page.get_by_role("button", name="开始使用", exact=True)


@pytest.mark.case("E-ENV-02")
def test_welcome_hide_next_time(app_factory):
    app = app_factory(dismiss_welcome=False)
    welcome(app).wait_for(timeout=10_000)
    toggle = app.page.get_by_role("button", name="下次不再显示")
    assert toggle.get_attribute("aria-pressed") == "false"
    toggle.click()
    assert toggle.get_attribute("aria-pressed") == "true"
    welcome(app).click()
    welcome(app).wait_for(state="detached", timeout=5000)
    app.reload_page()
    time.sleep(2)
    assert welcome(app).count() == 0, "勾选“下次不再显示”后重启不应再出现欢迎页"


@pytest.mark.case("E-ENV-02")
def test_welcome_shows_again_without_hide(app_factory):
    app = app_factory(dismiss_welcome=False)
    welcome(app).wait_for(timeout=10_000)
    welcome(app).click()
    welcome(app).wait_for(state="detached", timeout=5000)
    app.reload_page()
    welcome(app).wait_for(timeout=10_000)


@pytest.mark.case("E-ENV-03")
def test_welcome_links_via_shell_open(app_factory):
    app = app_factory(dismiss_welcome=False)
    welcome(app).wait_for(timeout=10_000)
    app.page.get_by_text("支持开发者").click()
    app.page.get_by_role("img", name="赞赏码").wait_for(timeout=5000)
    app.page.get_by_role("link", name="B 站主页").click()
    calls = app.wait_ipc("plugin:shell|open")
    assert any("space.bilibili.com/445111" in str(c.get("args")) for c in calls), calls
    assert all(c.get("stubbed") for c in calls), "不应真正打开浏览器"
    assert len(app.page.context.pages) == 1, "不应 window.open 新页"


@pytest.mark.case("E-ENV-11")
def test_corrupt_db_self_heal_from_backup(sandbox, app_factory):
    save = sandbox.default_save_dir
    good = dbh.create_legacy_db(save / "Backups" / "taglauncher_auto_20250101_000000_000.db", "20",
                                [("备份里的对象.txt", str(sandbox.files / "备份里的对象.txt"), "text")])
    assert good.exists()
    files.write(save / "taglauncher.db", b"definitely not sqlite " * 200)
    app = app_factory()
    wait_until(lambda: "备份里的对象.txt" in app.visible_names(), 15, lambda: app.visible_names())
    leftovers = [p.name for p in save.glob("taglauncher.db.corrupt-*")]
    assert leftovers, "坏库应改名留存为 .corrupt-*"
    assert dbh.scalar(sandbox.db_path, "PRAGMA integrity_check") == "ok"
    assert app.js_errors() == []


@pytest.mark.case("E-ENV-12")
def test_clear_recent_on_exit(app, sandbox):
    a = files.marker_exe(sandbox.files / "recent" / "最近A.exe")
    b = files.marker_exe(sandbox.files / "recent" / "最近B.exe")
    app.seed([a, b])
    for p in (a, b):
        app.invoke("launch_item", {"id": app.item(p.name)["id"]})
        files.wait_marker(p)
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE last_used_at IS NOT NULL") == 2, 5)
    dlg = app.open_settings("数据管理")
    sw = dlg.get_by_role("switch", name="退出时清除最近使用")
    assert sw.get_attribute("aria-checked") == "false"
    sw.click()
    wait_until(lambda: dbh.meta(sandbox.db_path, "recent.clear_on_exit") == "1", 5)
    code = app.stop(graceful=True)
    assert code is not None
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE last_used_at IS NOT NULL") == 0
    app.start()
    app.page.get_by_role("button", name="最近使用").click()
    time.sleep(1)
    assert app.visible_names() == []

