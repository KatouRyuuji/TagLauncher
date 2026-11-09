"""数据管理（E-DAT-*）。"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

AI_KEY = "sk-e2e-export-secret"
DAV_PWD = "dav-export-secret"


def set_secrets(app):
    app.invoke("ai_set_config", {"config": {"baseUrl": "http://localhost:9", "apiKey": AI_KEY, "model": "m",
                                            "autoTagOnAdd": False, "maxTags": 3, "allowNewTags": True,
                                            "extraPrompt": ""}})
    app.invoke("sync_set_config", {"config": {"url": "http://localhost:9/dav", "username": "u", "password": DAV_PWD,
                                              "remoteDir": "TL", "autoSync": False}})


def backups(sandbox) -> set[Path]:
    d = sandbox.save_dir / "Backups"
    return set(d.glob("*.db")) if d.exists() else set()


@pytest.mark.case("E-DAT-01")
def test_one_click_backup(app, sandbox):
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="一键备份").click()
    t = app.wait_toast("已备份到：", timeout=15)
    path = Path(t["message"].split("：", 1)[1].strip())
    assert path.exists(), path
    assert path.parent == sandbox.save_dir / "Backups", path
    with closing(sqlite3.connect(path)) as con:
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


@pytest.mark.case("E-DAT-03")
def test_export_redacted(app, sandbox):
    p = files.write(sandbox.files / "dat" / "导出对象.txt", "x")
    app.seed([p])
    set_secrets(app)
    target = sandbox.files / "导出" / "taglauncher_export.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    app.stub("plugin:dialog|save", str(target))
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="导出数据").click()
    app.wait_toast("数据已导出", timeout=15)
    blob = target.read_bytes()
    assert AI_KEY.encode() not in blob and DAV_PWD.encode() not in blob
    with closing(sqlite3.connect(target)) as con:
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert con.execute("SELECT name FROM items").fetchall() == [("导出对象.txt",)]
        assert con.execute("SELECT key FROM app_meta WHERE key IN ('ai.api_key','sync.password')").fetchall() == []
    assert dbh.meta(sandbox.db_path, "ai.api_key") == AI_KEY  # 本机库不受影响


@pytest.mark.case("E-DAT-04")
def test_import_and_restart(app, sandbox):
    p = files.write(sandbox.files / "dat" / "原有对象.txt", "x")
    app.seed([p])
    src = dbh.create_legacy_db(sandbox.artifacts / "import.db", "20",
                               [("导入对象.txt", str(sandbox.files / "导入对象.txt"), "text")])
    before = backups(sandbox)
    app.stub("plugin:dialog|open", str(src))
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="导入数据").click()
    app.reconnect_after_self_restart(timeout=60)
    app.close_welcome(4000)
    wait_until(lambda: app.visible_names() == ["导入对象.txt"], 15, lambda: app.visible_names())
    new = backups(sandbox) - before
    assert new, "导入前未自动备份原库"
    with closing(sqlite3.connect(next(iter(new)))) as con:
        assert ("原有对象.txt",) in con.execute("SELECT name FROM items").fetchall()


@pytest.mark.case("E-DAT-06")
def test_switch_data_dir_empty(app, sandbox):
    p = files.write(sandbox.files / "dat" / "迁移对象.txt", "x")
    app.seed([p])
    new_dir = sandbox.root / "新数据目录"
    new_dir.mkdir()
    app.stub("plugin:dialog|open", str(new_dir))
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="切换目录").click()
    app.reconnect_after_self_restart(timeout=60)
    app.close_welcome(4000)
    redirect = sandbox.bin / "datapath.json"
    assert redirect.exists()
    assert Path(json.loads(redirect.read_text(encoding="utf-8"))["save_dir"]) == new_dir
    assert (new_dir / "taglauncher.db").exists()
    wait_until(lambda: "迁移对象.txt" in app.visible_names(), 15, lambda: app.visible_names())
    info = app.invoke("get_data_directory_info")
    assert Path(info["saveDir"]) == new_dir and info["isCustom"] is True, info
