#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TagLauncher 数据目录迁移/自愈 E2E 场景矩阵（真实 exe × 沙箱）。

安全设计：子进程 LOCALAPPDATA / TEMP 注入到沙箱，不触碰真实
%LOCALAPPDATA%\\TagLauncher。

用法：
    python scripts/e2e-data-migration.py [exe路径]
    python scripts/e2e-data-migration.py --exe PATH --sandbox DIR --wait 7
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LATEST_SCHEMA = "14"

# v10 实库在跑完 v001–v010 后的最小完整表：含身份/签名列，type 尚无 video。
# 残缺夹具（只有 id/name/path/type）会在 v011 重建 items 时因缺列失败。
V10_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT CHECK(type IN ('folder', 'image', 'audio', 'exe', 'bat', 'ps1')),
    icon_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    is_favorite INTEGER DEFAULT 0,
    volume_serial INTEGER,
    file_id TEXT,
    is_missing INTEGER NOT NULL DEFAULT 0,
    sig_size INTEGER,
    sig_head INTEGER,
    sig_tail INTEGER
);
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#3b82f6'
);
CREATE TABLE IF NOT EXISTS item_tags (
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, tag_id)
);
CREATE TABLE IF NOT EXISTS cabinets (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cabinet_items (
    cabinet_id INTEGER REFERENCES cabinets(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (cabinet_id, item_id)
);
CREATE TABLE IF NOT EXISTS tag_relations (
    parent_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    child_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, child_id)
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def parse_args():
    parser = argparse.ArgumentParser(description="TagLauncher 数据迁移沙箱矩阵")
    parser.add_argument(
        "exe",
        nargs="?",
        default=os.path.join(ROOT, "src-tauri", "target", "release", "tag-launcher.exe"),
        help="被测 tag-launcher.exe",
    )
    parser.add_argument("--exe", dest="exe_opt", help="覆盖位置参数")
    parser.add_argument(
        "--sandbox",
        default=os.path.join(os.environ.get("TEMP", ROOT), "tl_e2e_matrix"),
    )
    parser.add_argument("--wait", type=float, default=7, help="每场景 GUI 停留秒数")
    parser.add_argument("--expected-schema", default=LATEST_SCHEMA)
    return parser.parse_args()


def reset(sandbox: str) -> None:
    for _ in range(20):
        try:
            shutil.rmtree(sandbox)
            break
        except FileNotFoundError:
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise RuntimeError("无法清理沙箱（前一场景进程未退干净）")
    os.makedirs(sandbox, exist_ok=True)


def run_exe(cwd: str, fake_local: str, wait: float) -> None:
    exe = os.path.join(cwd, "tag-launcher.exe")
    env = dict(os.environ)
    env["LOCALAPPDATA"] = fake_local
    env["TEMP"] = os.path.join(os.path.dirname(fake_local), "Temp")
    env["TMP"] = env["TEMP"]
    os.makedirs(env["TEMP"], exist_ok=True)
    process = subprocess.Popen([exe], cwd=cwd, env=env)
    time.sleep(wait)
    try:
        process.terminate()
    except OSError:
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    time.sleep(1)


def db_query(path: str, sql: str):
    if not os.path.exists(path):
        return None
    try:
        conn = sqlite3.connect("file:" + path + "?mode=ro", uri=True)
        rows = conn.execute(sql).fetchall()
        conn.close()
        return rows
    except Exception as exc:
        return f"ERR:{exc}"


def seed_db(save_dir: str, items=("a.exe", "b.exe"), with_backups=False) -> None:
    os.makedirs(save_dir, exist_ok=True)
    dbp = os.path.join(save_dir, "taglauncher.db")
    conn = sqlite3.connect(dbp)
    conn.executescript(V10_SCHEMA)
    conn.execute("INSERT OR REPLACE INTO app_meta VALUES ('schema_version', '10')")
    conn.execute("DELETE FROM items")
    for name in items:
        conn.execute(
            "INSERT INTO items (name, path, type, is_missing) VALUES (?, ?, 'exe', 0)",
            (name, "D:\\" + name),
        )
    conn.commit()
    conn.close()
    if with_backups:
        bdir = os.path.join(save_dir, "Backups")
        os.makedirs(bdir, exist_ok=True)
        shutil.copy(dbp, os.path.join(bdir, "taglauncher_pre_import_20260101_000000_000.db"))


def corrupt_junk(path: str) -> None:
    with open(path, "wb") as handle:
        handle.write(b"not a sqlite database at all" + b"\x00" * 4096)


def corrupt_mid_page(path: str) -> None:
    conn = sqlite3.connect(path)
    root = conn.execute("SELECT rootpage FROM sqlite_master WHERE name='app_meta'").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    conn.close()
    with open(path, "r+b") as handle:
        handle.seek((root - 1) * page_size)
        handle.write(b"\x00" * page_size)


def check(results, name, cond, detail=""):
    results.append((name, bool(cond)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")


def local_db(fake_local: str) -> str:
    return os.path.join(fake_local, "TagLauncher", "Save", "taglauncher.db")


def make_dir(sandbox: str, exe_src: str, tag: str) -> str:
    dest = os.path.join(sandbox, tag, "TagLauncher")
    os.makedirs(dest)
    shutil.copy(exe_src, os.path.join(dest, "tag-launcher.exe"))
    return dest


def main() -> int:
    args = parse_args()
    exe = args.exe_opt or args.exe
    if not os.path.exists(exe):
        print(f"找不到二进制：{exe}", file=sys.stderr)
        return 2

    sandbox = args.sandbox
    fake_local = os.path.join(sandbox, "_localappdata")
    results = []

    def go(cwd: str) -> None:
        run_exe(cwd, fake_local, args.wait)

    reset(sandbox)
    dest = make_dir(sandbox, exe, "A")
    go(dest)
    ver = db_query(local_db(fake_local), "SELECT value FROM app_meta WHERE key='schema_version'")
    check(results, "A 全新安装建库", ver and ver[0][0] == args.expected_schema, f"schema={ver}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "B")
    seed_db(os.path.join(dest, "Save"), items=("old1.exe", "old2.exe", "old3.exe"), with_backups=True)
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items ORDER BY name")
    check(results, "B 旧版数据迁移到 Local", names == [("old1.exe",), ("old2.exe",), ("old3.exe",)], f"items={names}")
    bdir = os.path.join(fake_local, "TagLauncher", "Save", "Backups")
    check(
        results,
        "B 历史备份随迁移",
        os.path.isdir(bdir) and any("pre_import" in name for name in os.listdir(bdir)),
        os.listdir(bdir) if os.path.isdir(bdir) else "无 Backups",
    )
    check(results, "B 原位置留底保留", os.path.exists(os.path.join(dest, "Save", "taglauncher.db")))
    migrated = db_query(local_db(fake_local), "SELECT value FROM app_meta WHERE key='schema_version'")
    check(results, "B 迁移后 schema", migrated and migrated[0][0] == args.expected_schema, f"schema={migrated}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "C")
    seed_db(os.path.join(dest, "Save"), items=("old.exe",))
    seed_db(os.path.join(fake_local, "TagLauncher", "Save"), items=("new.exe",))
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items")
    check(results, "C Local 健康库不被覆盖", names == [("new.exe",)], f"items={names}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "D")
    seed_db(os.path.join(fake_local, "TagLauncher", "Save"), items=("safe.exe",), with_backups=True)
    corrupt_junk(local_db(fake_local))
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items")
    leftover = [name for name in os.listdir(os.path.dirname(local_db(fake_local))) if ".corrupt-" in name]
    check(results, "D 损坏库自愈恢复", names == [("safe.exe",)], f"items={names}")
    check(results, "D 损坏现场留存", len(leftover) > 0, leftover)

    reset(sandbox)
    dest = make_dir(sandbox, exe, "E")
    seed_db(os.path.join(dest, "Save"), items=("stale.exe",))
    seed_db(os.path.join(fake_local, "TagLauncher", "Save"), items=("recent.exe",), with_backups=True)
    corrupt_mid_page(local_db(fake_local))
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items")
    check(results, "E 中间页损坏走自愈(非留底回退)", names == [("recent.exe",)], f"items={names}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "F")
    seed_db(os.path.join(dest, "Save"), items=("stale.exe",))
    seed_db(os.path.join(fake_local, "TagLauncher", "Save"), items=("recent.exe",))
    corrupt_mid_page(local_db(fake_local))
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items")
    check(results, "F 无备份时不被留底回退覆盖", names != [("stale.exe",)], f"items={names}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "G")
    seed_db(os.path.join(dest, "Save"), items=("old.exe",))
    os.makedirs(os.path.dirname(local_db(fake_local)))
    sqlite3.connect(local_db(fake_local)).execute(
        "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    ).connection.close()
    go(dest)
    names = db_query(local_db(fake_local), "SELECT name FROM items")
    check(results, "G 残骸被健康旧库覆盖", names == [("old.exe",)], f"items={names}")

    reset(sandbox)
    dest = make_dir(sandbox, exe, "H")
    custom = os.path.join(sandbox, "H", "CustomData")
    seed_db(custom, items=("custom.exe",))
    with open(os.path.join(dest, "datapath.json"), "w", encoding="utf-8") as handle:
        json.dump({"save_dir": custom}, handle)
    go(dest)
    check(
        results,
        "H 重定向生效",
        db_query(os.path.join(custom, "taglauncher.db"), "SELECT name FROM items") == [("custom.exe",)],
    )
    check(results, "H 未创建 Local 库", not os.path.exists(local_db(fake_local)))

    print()
    fails = [row for row in results if not row[1]]
    print(f"==== {len(results) - len(fails)}/{len(results)} 场景通过 ====")
    for name, _ in fails:
        print(f"  失败: {name}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
