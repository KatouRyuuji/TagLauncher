"""云同步 P1/P2（E-SYNC-05..10）：真实后端请求本机 WebDavMock。"""
from __future__ import annotations

import sqlite3
import time
from contextlib import closing

import pytest

from harness import db as dbh
from harness.app import wait_until
from harness.mocks import WebDavMock

USER, PWD = "e2e-user", "e2e-pass-xyz"
REMOTE = "TL"


@pytest.fixture
def dav():
    m = WebDavMock(USER, PWD)
    m.dirs.add(REMOTE)
    yield m
    m.close()


def set_cfg(app, dav, auto=False, password=PWD):
    app.invoke("sync_set_config", {"config": {"url": dav.url, "username": USER, "password": password,
                                              "remoteDir": REMOTE, "autoSync": auto}})


def remote_names(dav):
    return sorted(k.split("/", 1)[1] for k in dav.files if k.startswith(REMOTE + "/"))


@pytest.mark.case("E-SYNC-05")
def test_remote_retention_keeps_10(app, dav):
    olds = [f"taglauncher_2025010{d}_00000{i}.db" for d in range(1, 3) for i in range(6)]  # 12 份
    for n in olds:
        dav.files[f"{REMOTE}/{n}"] = b"old"
    dav.files[f"{REMOTE}/其他文件.txt"] = b"keep"
    set_cfg(app, dav)
    name = app.invoke("sync_backup_now")
    names = [n for n in remote_names(dav) if n.endswith(".db")]
    assert len(names) == 10, names
    assert name in names
    keep = sorted(olds, reverse=True)[:9]
    assert sorted(names) == sorted(keep + [name])
    assert f"{REMOTE}/其他文件.txt" in dav.files, "非备份文件不应被清理"
    deleted = [r.path for r in dav.requests if r.method == "DELETE"]
    assert len(deleted) == 3, deleted


@pytest.mark.case("E-SYNC-06")
def test_password_not_echoed_and_clear(app, dav):
    set_cfg(app, dav)
    cfg = app.invoke("sync_get_config")
    assert cfg["password"] == "" and cfg["hasPassword"] is True
    dlg = app.open_settings("云同步")
    pw = dlg.get_by_label("密码", exact=True)
    assert pw.input_value() == "", "已存密码不应回显到输入框"
    assert pw.get_attribute("type") == "password"
    assert PWD not in app.page.content()
    dlg.get_by_text("已配置", exact=True).wait_for(timeout=5000)
    dlg.get_by_role("button", name="清除密码").click()
    app.wait_toast("已清除保存的 WebDAV 密码")
    assert app.invoke("sync_get_config")["hasPassword"] is False
    assert not dbh.meta(app.sb.db_path, "sync.password")
    dlg.get_by_role("button", name="清除密码").wait_for(state="detached", timeout=5000)


@pytest.mark.case("E-SYNC-07")
def test_auto_cloud_backup_on_startup(app, dav):
    set_cfg(app, dav, auto=True)
    app.reload_page()  # 重新挂载前端 → 启动期维护再跑一次（15s 后）
    t0 = time.monotonic()
    app.wait_toast("已自动备份到云端", timeout=40)
    assert time.monotonic() - t0 >= 10, "自动云备份应延迟约 15s"
    assert any(r.method == "PUT" for r in dav.requests)
    assert app.invoke("sync_get_config")["lastSyncTs"] > 0
    # 24h 内再次启动不再自动备份
    n = len(dav.requests)
    app.reload_page()
    time.sleep(20)
    assert not any(r.method == "PUT" for r in dav.requests[n:])
    assert not [t for t in app.toasts() if "自动" in t.get("message", "")]


@pytest.mark.case("E-SYNC-07")
def test_auto_cloud_backup_failure_toast(app, dav):
    set_cfg(app, dav, auto=True)
    dav.hook = lambda r: (507, {}, b"") if r.method == "PUT" else None
    app.reload_page()
    t = app.wait_toast("自动云备份失败：", timeout=40)
    assert "存储空间不足" in t["message"], t


@pytest.mark.case("E-SYNC-08")
@pytest.mark.parametrize("status,hint", [
    (401, "认证失败"), (403, "拒绝访问"), (405, "不支持该 WebDAV 操作"), (507, "存储空间不足"),
])
def test_backup_error_mapping(app, dav, status, hint):
    existing = f"{REMOTE}/taglauncher_20250101_000000.db"
    dav.files[existing] = b"keep-me"
    set_cfg(app, dav)
    dav.hook = lambda r: (status, {}, b"") if r.method in ("PUT", "MOVE") else None
    dlg = app.open_settings("云同步")
    dlg.get_by_role("button", name="立即备份到云端").click()
    t = app.wait_toast("云端备份失败：", timeout=30)
    assert hint in t["message"], t
    assert dav.files[existing] == b"keep-me", "失败不应覆盖已有远端备份"
    assert not [k for k in dav.files if k.endswith(".db") and k != existing], list(dav.files)
    assert app.invoke("sync_get_config").get("lastSyncTs", 0) == 0
    assert PWD not in t["message"]


@pytest.mark.case("E-SYNC-08")
def test_retry_on_transient_then_ok(app, dav):
    set_cfg(app, dav)
    state = {"n": 0}

    def flaky(r):
        if r.method == "PUT" and state["n"] < 1:
            state["n"] += 1
            return 503, {}, b""
        return None
    dav.hook = flaky
    name = app.invoke("sync_backup_now")
    assert f"{REMOTE}/{name}" in dav.files
    assert state["n"] == 1


@pytest.mark.case("E-SYNC-09")
@pytest.mark.parametrize("bad", ["../x.db", "..\\x.db", "a/b.db", "x.txt", "  "])
def test_restore_rejects_traversal(app, dav, bad):
    set_cfg(app, dav)
    err = app.invoke_error("sync_restore", {"fileName": bad})
    assert err and "非法的云端备份文件名" in err, err
    assert not [r for r in dav.requests if r.method == "GET"]


@pytest.mark.case("E-SYNC-09")
def test_list_ignores_foreign_names(app, dav):
    dav.files[f"{REMOTE}/taglauncher_20250101_000000.db"] = b"x"
    dav.files[f"{REMOTE}/evil.db"] = b"x"
    dav.files[f"{REMOTE}/taglauncher_note.txt"] = b"x"
    set_cfg(app, dav)
    names = [b["name"] for b in app.invoke("sync_list_backups")]
    assert names == ["taglauncher_20250101_000000.db"], names


@pytest.mark.case("E-SYNC-10")
def test_empty_remote_list(app, dav):
    set_cfg(app, dav)
    dlg = app.open_settings("云同步")
    dlg.get_by_role("button", name="查看云端备份").click()
    dlg.get_by_text("云端暂无备份").wait_for(timeout=15000)
    dlg.get_by_role("button", name="收起云端备份").click()
    dlg.get_by_text("云端暂无备份").wait_for(state="detached", timeout=5000)


@pytest.mark.case("E-SYNC-10")
def test_unconfigured_buttons_disabled(app):
    dlg = app.open_settings("云同步")
    dlg.get_by_text("未配置", exact=True).wait_for(timeout=5000)
    for b in ("测试连接", "立即备份到云端", "查看云端备份"):
        assert dlg.get_by_role("button", name=b).is_disabled(), b
