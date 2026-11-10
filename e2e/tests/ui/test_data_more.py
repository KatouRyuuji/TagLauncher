"""数据管理 P1/P2（E-DAT-02/05/07/08/09/10）。CDP + IPC，不开真实资源管理器。"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def shell_paths(app):
    out = []
    for c in app.calls("plugin:shell|open"):
        a = c.get("args") or {}
        out.append(a.get("path") or a.get("url") or str(a))
    return out


@pytest.mark.case("E-DAT-02")
def test_open_backups_dir_ipc(app, sandbox):
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="打开备份目录").click()
    got = app.wait_ipc("plugin:shell|open")
    assert all(c.get("stubbed") for c in got), "不应真的拉起资源管理器"
    p = Path(shell_paths(app)[-1])
    assert p.resolve() == (sandbox.save_dir / "Backups").resolve(), p


@pytest.mark.case("E-DAT-05")
@pytest.mark.parametrize("kind,hint", [
    ("junk", "不是有效的"),
    ("noschema", "缺少 schema_version"),
    ("future", "高于当前应用支持的版本"),
])
def test_import_invalid_rejected(app, sandbox, kind, hint):
    p = files.write(sandbox.files / "dat5" / "原有.txt", "x")
    app.seed([p])
    src = sandbox.artifacts / f"{kind}.db"
    if kind == "junk":
        src.write_bytes(b"this is not sqlite" * 100)
    elif kind == "noschema":
        import sqlite3
        from contextlib import closing
        with closing(sqlite3.connect(src)) as con:
            con.execute("CREATE TABLE x(a)")
            con.commit()
    else:
        dbh.create_legacy_db(src, "99", [("未来.txt", "D:\\e2e-nonexistent\\f.txt", "text")])
    before = dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items")
    app.stub("plugin:dialog|open", str(src))
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="导入数据").click()
    app.wait_toast(hint, timeout=15)
    time.sleep(1.0)
    assert app.proc.poll() is None, "非法导入不应触发重启"
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == before
    assert [i["name"] for i in app.items()] == ["原有.txt"]
    assert dbh.meta(sandbox.db_path, "schema_version") == dbh.current_schema_version()


@pytest.mark.case("E-DAT-07")
def test_switch_to_existing_library(app, sandbox):
    p = files.write(sandbox.files / "dat7" / "当前库对象.txt", "x")
    app.seed([p])
    target = sandbox.root / "已有库目录"
    dbh.create_legacy_db(target / "taglauncher.db", "20",
                         [("目标库对象.txt", str(sandbox.files / "目标库对象.txt"), "text")])
    app.stub("plugin:dialog|open", str(target))
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="切换目录").click()
    dlg.get_by_text("目标目录已存在 TagLauncher 数据库").wait_for(timeout=10_000)
    # 取消分支：不改动
    dlg.get_by_role("button", name="取消", exact=True).click()
    dlg.get_by_text("目标目录已存在 TagLauncher 数据库").wait_for(state="detached", timeout=5000)
    assert not (sandbox.bin / "datapath.json").exists()
    # 采用分支
    dlg.get_by_role("button", name="切换目录").click()
    dlg.get_by_role("button", name="直接使用该目录数据").click()
    app.reconnect_after_self_restart(timeout=60)
    app.close_welcome(4000)
    wait_until(lambda: app.visible_names() == ["目标库对象.txt"], 15, lambda: app.visible_names())
    info = app.invoke("get_data_directory_info")
    assert Path(info["saveDir"]).resolve() == target.resolve(), info
    # 原目录数据保留不动
    assert dbh.scalar(sandbox.default_save_dir / "taglauncher.db", "SELECT COUNT(*) FROM items") == 1


@pytest.mark.case("E-DAT-08")
def test_reset_to_default_dir(sandbox, app_factory):
    custom = sandbox.root / "自定义目录"
    custom.mkdir()
    sandbox.redirect_data(custom)
    app = app_factory()
    dlg = app.open_settings("数据管理")
    btn = dlg.get_by_role("button", name="恢复默认")
    assert btn.is_enabled()
    btn.click()
    app.reconnect_after_self_restart(timeout=60)
    app.close_welcome(4000)
    info = app.invoke("get_data_directory_info")
    assert info["isCustom"] is False, info
    assert Path(info["saveDir"]).resolve() == sandbox.default_save_dir.resolve(), info
    assert (sandbox.default_save_dir / "taglauncher.db").exists()
    dlg = app.open_settings("数据管理")
    assert dlg.get_by_role("button", name="恢复默认").is_disabled()


@pytest.mark.case("E-DAT-09")
def test_auto_backup_and_retention(sandbox, app_factory):
    bdir = sandbox.default_save_dir / "Backups"
    bdir.mkdir(parents=True, exist_ok=True)
    old = time.time() - 3 * 86400
    olds = []
    for i in range(9):
        f = bdir / f"taglauncher_auto_20200101_0000{i:02d}.db"
        f.write_bytes(b"old")
        os.utime(f, (old, old))
        olds.append(f)
    manual = bdir / "taglauncher_backup_20200101_000000.db"
    manual.write_bytes(b"manual")
    # t0 取启动前：start() 要等页面就绪，CI 上冷启动 ~10s，延迟 10s 的备份可能在其返回前已写出
    t0 = time.monotonic()
    app = app_factory()

    def autos():
        return sorted(p.name for p in bdir.glob("taglauncher_auto_*.db"))

    wait_until(lambda: any(not n.startswith("taglauncher_auto_2020") for n in autos()), 30, autos)
    elapsed = time.monotonic() - t0
    wait_until(lambda: len(autos()) == 7, 10, autos)
    names = autos()
    new = [n for n in names if not n.startswith("taglauncher_auto_2020")]
    assert len(new) == 1, names
    # 留下的是最新 6 份旧的 + 新的；最旧的 3 份被清
    assert all(f.name not in names for f in olds[:3]) and all(f.name in names for f in olds[3:]), names
    assert manual.exists(), "手动备份不在自动清理范围"
    assert dbh.scalar(bdir / new[0], "PRAGMA integrity_check") == "ok"
    assert elapsed >= 5, f"自动备份应延迟约 10s 触发，实际 {elapsed:.1f}s"
    # 24h 内重启不再备份
    app.restart()
    time.sleep(13)
    assert len([n for n in autos() if not n.startswith("taglauncher_auto_2020")]) == 1, autos()


@pytest.mark.case("E-DAT-10")
@pytest.mark.parametrize("where", ["ProgramFiles", "exe_sibling"])
def test_legacy_location_migrated(sandbox, app_factory, where):
    if where == "ProgramFiles":
        legacy_save = sandbox.root / "ProgramFiles" / "TagLauncher" / "Save"
    else:
        legacy_save = sandbox.bin / "Save"
    src = dbh.create_legacy_db(legacy_save / "taglauncher.db", "20",
                               [("旧位置对象.txt", str(sandbox.files / "旧位置对象.txt"), "text")])
    (legacy_save / "Backups").mkdir()
    shutil.copy2(src, legacy_save / "Backups" / "taglauncher_backup_20200101_000000.db")
    src_bytes = src.read_bytes()
    assert not (sandbox.default_save_dir / "taglauncher.db").exists()
    app = app_factory()
    wait_until(lambda: "旧位置对象.txt" in app.visible_names(), 15, lambda: app.visible_names())
    assert (sandbox.default_save_dir / "taglauncher.db").exists()
    assert (sandbox.default_save_dir / "Backups" / "taglauncher_backup_20200101_000000.db").exists()
    assert src.read_bytes() == src_bytes, "旧库应只读复制，不被改写"
    # APPDATA roaming 候选走 SHGetKnownFolderPath，无法沙箱化：不测（会碰真实用户目录）
