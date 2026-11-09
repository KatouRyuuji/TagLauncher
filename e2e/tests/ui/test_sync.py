"""云同步（E-SYNC-*）：后端真实请求本机 WebDavMock（127.0.0.1）。"""
from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest

from harness import db as dbh
from harness.app import wait_until
from harness.mocks import WebDavMock

USER, PWD = "e2e-user", "e2e-pass-xyz"
AI_KEY = "sk-e2e-ai-should-not-upload"
REMOTE = "TL/备份"


@pytest.fixture
def dav():
    m = WebDavMock(USER, PWD)
    yield m
    m.close()


def configure(app, dav):
    dlg = app.open_settings("云同步")
    dlg.get_by_label("WebDAV 服务器地址").fill(dav.url)
    dlg.get_by_label("用户名").fill(USER)
    dlg.get_by_label("密码", exact=True).fill(PWD)
    dlg.get_by_label("远端目录").fill(REMOTE)
    return dlg


@pytest.mark.case("E-SYNC-01")
def test_connection(app, dav):
    dlg = configure(app, dav)
    dlg.get_by_role("button", name="测试连接").click()
    app.wait_toast("已连通", timeout=15)
    pf = [r for r in dav.requests if r.method == "PROPFIND"]
    assert pf and pf[0].headers.get("authorization") == dav.auth
    assert {"TL", REMOTE} <= dav.dirs, dav.dirs


@pytest.mark.case("E-SYNC-02")
@pytest.mark.case("E-SYNC-04")
def test_backup_now_strips_secrets(app, dav, sandbox):
    app.invoke("ai_set_config", {"config": {"baseUrl": "http://localhost:9", "apiKey": AI_KEY, "model": "m",
                                            "autoTagOnAdd": False, "maxTags": 3, "allowNewTags": True,
                                            "extraPrompt": ""}})
    dlg = configure(app, dav)
    dlg.get_by_role("button", name="立即备份到云端").click()
    t = app.wait_toast("已备份到云端：", timeout=20)
    name = t["message"].split("：", 1)[1].strip()
    assert name.startswith("taglauncher_") and name.endswith(".db"), name
    ms = dav.methods()
    assert "PUT" in ms and "MOVE" in ms, ms
    put = next(r for r in dav.requests if r.method == "PUT")
    assert put.path.endswith(".db.part"), put.path
    key = f"{REMOTE}/{name}"
    assert key in dav.files, list(dav.files)
    up = sandbox.artifacts / "uploaded.db"
    up.write_bytes(dav.files[key])
    with closing(sqlite3.connect(up)) as con:
        secrets = con.execute("SELECT key FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'").fetchall()
        assert secrets == [], secrets
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    blob = dav.files[key]
    assert PWD.encode() not in blob and AI_KEY.encode() not in blob
    assert dbh.meta(sandbox.db_path, "sync.password") == PWD  # 本机凭据仍在


@pytest.mark.case("E-SYNC-03")
def test_restore_from_cloud(app, dav, sandbox):
    fixture = dbh.create_legacy_db(sandbox.artifacts / "cloud.db", "20",
                                   [("云端对象.txt", str(sandbox.files / "云端对象.txt"), "text")])
    dav.dirs.update({"TL", REMOTE})
    dav.files[f"{REMOTE}/taglauncher_20260101_000000.db"] = fixture.read_bytes()
    dlg = configure(app, dav)
    dlg.get_by_role("button", name="保存配置").click()
    app.wait_toast("云同步配置已保存")
    dlg.get_by_role("button", name="查看云端备份").click()
    dlg.get_by_role("button", name="恢复", exact=True).first.click()
    dlg.get_by_role("button", name="确认恢复").click()
    app.reconnect_after_self_restart(timeout=60)
    app.close_welcome(4000)
    wait_until(lambda: "云端对象.txt" in app.visible_names(), 15, lambda: app.visible_names())
    backups = list((sandbox.save_dir / "Backups").glob("taglauncher_pre_restore_*.db"))
    assert backups, "恢复前未做本地安全备份"
    cfg = app.invoke("sync_get_config")
    assert cfg["url"] == dav.url and cfg.get("hasPassword") is True, cfg
