"""CLI 层：tl.exe（E-CLI-*、E-SEC-03、E-ENV-14）。"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import closing

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until
from harness.integrity import real_dirs, tree_digest


def _zoo(sb):
    return files.type_zoo(sb.files / "zoo")


@pytest.mark.case("E-CLI-01")
def test_list_get_stats_json_match_db(tl, sandbox):
    tl.ensure_db()
    zoo = _zoo(sandbox)
    added = tl.json("add", *zoo.values())
    assert added["created"] == len(zoo) and added["failed"] == []
    listed = tl.json("list")
    rows = dbh.query(sandbox.db_path, "SELECT id, name, path, type FROM items ORDER BY id")
    assert sorted((i["id"], i["name"], i["path"], i["type"]) for i in listed) == rows
    first = listed[0]
    got = tl.json("get", first["id"])
    assert got["id"] == first["id"] and got["path"] == first["path"] and got["tags"] == []
    stats = tl.json("stats")
    assert stats["items"] == len(rows)
    by_type = dict(dbh.query(sandbox.db_path, "SELECT type, COUNT(*) FROM items GROUP BY type"))
    assert dict(map(tuple, stats["by_type"])) == by_type


@pytest.mark.case("E-CLI-02")
def test_search_matches_gui(tl, sandbox, app_factory):
    tl.ensure_db()
    zoo = _zoo(sandbox)
    tl.json("add", *zoo.values())
    queries = ["脚本", "png", "说明", "音乐 || 视频", "!!图片"]
    cli = {q: sorted(i["id"] for i in tl.json("search", q)) for q in queries}
    only_bat = tl.json("search", "脚本", "--type", "bat")
    assert [i["type"] for i in only_bat] == ["bat"]
    app = app_factory()
    for q in queries:
        gui = sorted(i["id"] for i in app.invoke("search_items", {"query": q, "tagIds": []}))
        assert cli[q] == gui, q
    assert cli["脚本"], "“脚本”应命中 脚本.bat / 脚本.ps1"


@pytest.mark.case("E-CLI-03")
def test_add_remove_visible_in_gui(tl, sandbox, app_factory):
    tl.ensure_db()
    app = app_factory()
    target = files.write(sandbox.files / "带 空格 的目录" / "中文 文件.txt", "hello")
    out = tl.json("add", target)
    assert out["created"] == 1
    app.refresh_items()
    app.wait_count(1)
    assert app.visible_names() == ["中文 文件.txt"]
    item_id = tl.json("list")[0]["id"]
    assert tl.json("remove", item_id) == {"removed": [item_id]}
    app.refresh_items()
    wait_until(lambda: app.visible_names() == [], 8, "移除后列表应为空")
    assert target.exists(), "remove 不应删除磁盘文件"


@pytest.mark.case("E-CLI-04")
def test_launch_by_id_and_query(tl, sandbox):
    tl.ensure_db()
    bat1 = files.marker_exe(sandbox.files / "启动一号.exe")
    bat2 = files.marker_exe(sandbox.files / "launch-two.exe")
    tl.json("add", bat1, bat2)
    ids = {i["name"]: i["id"] for i in tl.json("list")}
    assert tl.json("launch", ids["启动一号.exe"]) == {"launched": ids["启动一号.exe"]}
    assert tl.json("launch", "launch-two") == {"launched": ids["launch-two.exe"]}
    for bat in (bat1, bat2):
        files.wait_marker(bat)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE last_used_at IS NOT NULL") == 2


@pytest.mark.case("E-CLI-05")
def test_fav_tag_cabinet(tl, sandbox):
    tl.ensure_db()
    zoo = _zoo(sandbox)
    tl.json("add", zoo["txt"], zoo["md"])
    ids = [i["id"] for i in tl.json("list")]
    assert tl.json("fav", *ids)["favorite"] is True
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE is_favorite=1") == 2
    tl.json("fav", ids[0], "--off")
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE is_favorite=1") == 1
    tag = tl.json("tag", "add", "工作", "--color", "#ff0000")
    assert tag["name"] == "工作" and tag["color"].lower() == "#ff0000"
    assert [t["name"] for t in tl.json("tag", "list")] == ["工作"]
    tl.json("tag", "set", ids[0], "工作")
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM item_tags WHERE item_id=?", (ids[0],)) == 1
    bad = tl.run("tag", "set", ids[0], "不存在的标签", check=False)
    assert bad.returncode != 0 and "不存在" in bad.err
    tl.json("tag", "clear", ids[0])
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM item_tags") == 0
    assert tl.json("cabinet", "list") == []
    with closing(sqlite3.connect(sandbox.db_path)) as con:
        con.execute("INSERT INTO cabinets(name, color) VALUES('柜子', '#00aa00')")
        cab = con.execute("SELECT id FROM cabinets").fetchone()[0]
        con.execute("INSERT INTO cabinet_items(cabinet_id, item_id) VALUES(?, ?)", (cab, ids[1]))
        con.commit()
    assert [c["name"] for c in tl.json("cabinet", "list")] == ["柜子"]
    assert [i["id"] for i in tl.json("cabinet", "items", cab)] == [ids[1]]


@pytest.mark.case("E-CLI-06")
def test_add_partial_failure_exits_nonzero(tl, sandbox):
    """部分路径失败：退出码 1 + stderr「错误」，--json 的 stdout 仍是完整结果并列出失败明细。"""
    tl.ensure_db()
    good = files.write(sandbox.files / "部分" / "在.txt", "ok")
    gone = sandbox.files / "部分" / "不存在.txt"
    r = tl.run("--json", "add", good, gone, check=False)
    assert r.returncode == 1, (r.returncode, r.out, r.err)
    assert "错误" in r.err and "1 个路径添加失败" in r.err, r.err
    out = json.loads(r.out)
    assert out["created"] == 1 and [f["path"] for f in out["failed"]] == [str(gone)], out
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 1
    plain = tl.run("add", gone, check=False)
    assert plain.returncode == 1 and "失败" in plain.err and str(gone) in plain.err, plain.err


@pytest.mark.case("E-CLI-06")
def test_argument_errors(tl, sandbox):
    tl.ensure_db()
    for args in (["get"], ["get", "abc"], ["remove"], ["fav"], ["add"], ["get", "999999"], ["launch", "没有这个"]):
        r = tl.run(*args, check=False)
        assert r.returncode != 0, args
        assert r.err.strip(), f"{args} 应有错误输出"
    r = tl.run("get", "999999", check=False)
    assert "错误" in r.err


@pytest.mark.case("E-CLI-07")
def test_missing_corrupt_future_db(tl, sandbox):
    r = tl.run("list", check=False)
    assert r.returncode == 1 and "数据库不存在" in r.err
    assert not sandbox.db_path.exists(), "无库时不应静默新建"
    sandbox.db_path.parent.mkdir(parents=True, exist_ok=True)
    garbage = b"this is not a sqlite database" * 100
    sandbox.db_path.write_bytes(garbage)
    r = tl.run("list", check=False)
    assert r.returncode != 0 and r.err.strip()
    assert sandbox.db_path.read_bytes() == garbage, "损坏库不应被改写"
    sandbox.db_path.unlink()
    dbh.create_legacy_db(sandbox.db_path, schema_version="999", items=[("未来项", "D:\\x\\a.txt", "text")])
    r = tl.run("list", check=False)
    assert r.returncode != 0 and "高于本程序支持" in r.err, f"未来版本库应拒绝：{r.out} {r.err}"
    # 用户数据与版本号不变（注：版本检查前 Database::init 已执行 WAL 切换与 CREATE IF NOT EXISTS，
    # 文件字节会变——观察项，非数据破坏）
    assert dbh.meta(sandbox.db_path, "schema_version") == "999"
    assert dbh.query(sandbox.db_path, "SELECT name FROM items") == [("未来项",)]
    assert dbh.scalar(sandbox.db_path, "PRAGMA integrity_check") == "ok"


@pytest.mark.case("E-CLI-08")
def test_concurrent_gui_and_cli_writes(tl, sandbox, app_factory):
    tl.ensure_db()
    app = app_factory()
    batch = [files.write(sandbox.files / "并发" / f"f{i:03d}.txt", str(i)) for i in range(60)]
    gui_batch = [files.write(sandbox.files / "并发GUI" / f"g{i:03d}.txt", str(i)) for i in range(60)]
    import threading
    errors = []

    gui_failed = []

    def gui_side():
        try:
            for chunk in range(0, 60, 10):
                res = app.invoke("add_items", {"paths": [str(p) for p in gui_batch[chunk:chunk + 10]]})
                gui_failed.extend((res or {}).get("failed") or [])
        except Exception as e:  # noqa: BLE001
            errors.append(e)
    # Playwright 同步 API 不能跨线程：GUI 写在主线程，CLI 写在后台线程
    results = []
    t = threading.Thread(target=lambda: results.extend(
        tl.run("--json", "add", *batch[i:i + 10]) for i in range(0, 60, 10)))
    t.start()
    gui_side()
    t.join(120)
    assert not errors
    assert not gui_failed, gui_failed
    assert all(r.returncode == 0 for r in results), [r.err for r in results]
    assert all("locked" not in r.err for r in results)
    names = {r[0] for r in dbh.query(sandbox.db_path, "SELECT name FROM items")}
    missing = sorted({p.name for p in batch + gui_batch} - names)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 120, (
        f"缺失 {missing}；GUI failed={gui_failed}；CLI stdout/err={[(r.out[-400:], r.err[-400:]) for r in results]}")
    assert len(app.items()) == 120


@pytest.mark.case("E-SEC-03")
def test_export_and_logs_do_not_leak_secrets(tl, sandbox, app_factory, ai_mock, dav_mock):
    tl.ensure_db()
    secret_key = "sk-e2e-SECRET-0123456789"
    secret_pw = dav_mock.password
    app = app_factory()
    app.invoke("ai_set_config", {"config": {"baseUrl": ai_mock.url, "apiKey": secret_key, "model": "mock",
                                            "autoTagOnAdd": False, "maxTags": 3, "allowNewTags": True, "extraPrompt": ""}})
    app.invoke("sync_set_config", {"config": {"url": dav_mock.url + "/dav", "username": dav_mock.user,
                                              "password": secret_pw, "remoteDir": "TagLauncher", "autoSync": False}})
    assert app.invoke("ai_get_config")["apiKey"] == ""
    assert app.invoke("sync_get_config")["password"] == ""
    app.invoke("ai_test_connection")
    app.invoke("sync_test_connection")
    export = sandbox.files / "export.db"
    app.invoke("export_data", {"targetPath": str(export)})
    app.stop()
    assert export.exists()
    blob = export.read_bytes()
    assert secret_key.encode() not in blob and secret_pw.encode() not in blob
    with closing(sqlite3.connect(export)) as con:
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    for out in (tl.run("--json", "list").out, tl.run("--json", "stats").out):
        assert secret_key not in out
    logs = [p for p in sandbox.root.glob("process-*.log")]
    real_log = real_dirs()[1] / "logs" / "TagLauncher.log"
    if real_log.exists():
        logs.append(real_log)
    for p in logs:
        text = p.read_text(encoding="utf-8", errors="replace")
        assert secret_key not in text and secret_pw not in text, p


@pytest.mark.case("E-ENV-14", "E-ENV-08")
def test_sandbox_isolation_real_dirs(sandbox, app_factory, real_dir_guard):
    """真实 %LOCALAPPDATA%\\TagLauncher 零变化；已知文件夹（窗口状态/日志）泄漏仅限这两类文件，会话结束统一还原。"""
    save_root = real_dirs()[2]
    before = tree_digest(save_root)
    app = app_factory()
    zoo = _zoo(sandbox)
    app.seed([zoo["txt"], zoo["png"]])
    app.stop()
    assert sandbox.db_path.exists(), "DB 应建在沙箱"
    assert tree_digest(save_root) == before, "真实数据目录被改动"
    leaked = []
    for d in real_dirs()[:2]:
        if d.exists():
            leaked += [p.relative_to(d).as_posix() for p in d.rglob("*") if p.is_file()]
    allowed = {".window-state.json", "logs/TagLauncher.log"}
    assert set(leaked) <= allowed, f"沙箱运行写到真实目录的非预期文件：{leaked}"
    # E-ENV-08：日志走 Tauri app_log_dir（Windows 已知文件夹，不随 LOCALAPPDATA 环境变量），
    # 只能落在真实 %LOCALAPPDATA%\\com.taglauncher.app\\logs——测试环境限制，会话结束由守卫还原。
    log = real_dirs()[1] / "logs" / "TagLauncher.log"
    assert log.exists() and log.stat().st_size > 0, "日志文件应落盘"
    assert time.time() - log.stat().st_mtime < 120, "日志应为本次运行写入"
