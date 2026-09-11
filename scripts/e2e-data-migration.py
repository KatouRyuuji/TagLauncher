#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TagLauncher 数据目录迁移/自愈 E2E 场景矩阵（真实 release exe × 沙箱）。

用途：发版前或改动数据目录/迁移/自愈逻辑后，验证真实二进制的落盘行为。
覆盖场景：全新安装、旧版自动迁移、损坏自愈、留底不回退、重定向等。

安全设计：通过子进程 LOCALAPPDATA 环境变量注入把应用的默认数据目录
（path_service::default_save_dir 读 LOCALAPPDATA）重定向到沙箱内部，
全程不触碰真实 %LOCALAPPDATA%\\TagLauncher。

用法：
    python scripts/e2e-data-migration.py [exe路径]   # 默认 src-tauri/target/release/tag-launcher.exe

注意：启动真实 GUI 进程（会出现窗口闪现），每场景启动后停留数秒再终止。
需要本机 Python 3.8+（标准库即可）。不是 CI 门禁，属发版前手动验证工具。
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "src-tauri", "target", "release", "tag-launcher.exe"
)
SANDBOX = os.path.join(os.environ.get("TEMP", ROOT), "tl_e2e_matrix")
# 伪造的用户数据根：exe 子进程的 LOCALAPPDATA 指向沙箱内
FAKE_LOCAL = os.path.join(SANDBOX, "_localappdata")

results = []


def reset():
    for i in range(20):
        try:
            shutil.rmtree(SANDBOX)
            break
        except FileNotFoundError:
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise RuntimeError("无法清理沙箱（前一场景进程未退干净）")
    os.makedirs(SANDBOX, exist_ok=True)


def run_exe(cwd, wait=7):
    """启动沙箱内 exe 副本（root_dir 由 current_exe 决定），注入伪 LOCALAPPDATA。"""
    exe = os.path.join(cwd, "tag-launcher.exe")
    env = dict(os.environ)
    env["LOCALAPPDATA"] = FAKE_LOCAL
    p = subprocess.Popen([exe], cwd=cwd, env=env)
    time.sleep(wait)
    try:
        p.terminate()
    except OSError:
        pass
    try:
        p.wait(timeout=8)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait(timeout=5)
    time.sleep(1)  # 句柄/OS 清理余量


def db_query(path, sql):
    if not os.path.exists(path):
        return None
    try:
        conn = sqlite3.connect("file:" + path + "?mode=ro", uri=True)
        rows = conn.execute(sql).fetchall()
        conn.close()
        return rows
    except Exception as e:
        return f"ERR:{e}"


def seed_db(save_dir, items=("a.exe", "b.exe"), with_backups=False):
    """造一个健康的旧版库（WAL 模式，模拟真实使用中的落盘形态）"""
    os.makedirs(save_dir, exist_ok=True)
    dbp = os.path.join(save_dir, "taglauncher.db")
    conn = sqlite3.connect(dbp)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("INSERT OR REPLACE INTO app_meta VALUES ('schema_version', '10')")
    conn.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, path TEXT, type TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("DELETE FROM items")
    for n in items:
        conn.execute("INSERT INTO items (name, path, type) VALUES (?, ?, 'exe')", (n, "D:\\" + n))
    conn.commit()
    conn.close()  # close 触发 checkpoint；WAL 旁文件随之合并
    if with_backups:
        bdir = os.path.join(save_dir, "Backups")
        os.makedirs(bdir, exist_ok=True)
        shutil.copy(dbp, os.path.join(bdir, "taglauncher_pre_import_20260101_000000_000.db"))


def corrupt_junk(path):
    with open(path, "wb") as f:
        f.write(b"not a sqlite database at all" + b"\x00" * 4096)


def corrupt_mid_page(path):
    """填零 app_meta 根页：sqlite_master 可读但 app_meta 查询必报错（中间页损坏形态）"""
    conn = sqlite3.connect(path)
    root = conn.execute("SELECT rootpage FROM sqlite_master WHERE name='app_meta'").fetchone()[0]
    ps = conn.execute("PRAGMA page_size").fetchone()[0]
    conn.close()
    with open(path, "r+b") as f:
        f.seek((root - 1) * ps)
        f.write(b"\x00" * ps)


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")


def local_db():
    return os.path.join(FAKE_LOCAL, "TagLauncher", "Save", "taglauncher.db")


def make_dir(tag):
    d = os.path.join(SANDBOX, tag, "TagLauncher")
    os.makedirs(d)
    shutil.copy(EXE, os.path.join(d, "tag-launcher.exe"))
    return d


# ── 场景 A：全新安装（无历史数据）──
reset()
d = make_dir("A")
run_exe(d)
ver = db_query(local_db(), "SELECT value FROM app_meta WHERE key='schema_version'")
check("A 全新安装建库", ver and ver[0][0] == "10", f"schema={ver}")

# ── 场景 B：旧版 exe 旁 Save/（健康+备份）→ 自动迁移 ──
reset()
d = make_dir("B")
seed_db(os.path.join(d, "Save"), items=("old1.exe", "old2.exe", "old3.exe"), with_backups=True)
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items ORDER BY name")
check("B 旧版数据迁移到 Local", names == [("old1.exe",), ("old2.exe",), ("old3.exe",)], f"items={names}")
bdir = os.path.join(FAKE_LOCAL, "TagLauncher", "Save", "Backups")
check("B 历史备份随迁移", os.path.isdir(bdir) and any("pre_import" in f for f in os.listdir(bdir)),
      os.listdir(bdir) if os.path.isdir(bdir) else "无 Backups")
check("B 原位置留底保留", os.path.exists(os.path.join(d, "Save", "taglauncher.db")))

# ── 场景 C：Local 已有健康库 + exe 旁留底 → 不重复迁移 ──
reset()
d = make_dir("C")
seed_db(os.path.join(d, "Save"), items=("old.exe",))
seed_db(os.path.join(FAKE_LOCAL, "TagLauncher", "Save"), items=("new.exe",))
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items")
check("C Local 健康库不被覆盖", names == [("new.exe",)], f"items={names}")

# ── 场景 D：Local 垃圾字节损坏 + Backups 有备份 → 自愈恢复 ──
reset()
d = make_dir("D")
seed_db(os.path.join(FAKE_LOCAL, "TagLauncher", "Save"), items=("safe.exe",), with_backups=True)
corrupt_junk(local_db())
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items")
leftover = [f for f in os.listdir(os.path.dirname(local_db())) if ".corrupt-" in f]
check("D 损坏库自愈恢复", names == [("safe.exe",)], f"items={names}")
check("D 损坏现场留存", len(leftover) > 0, leftover)

# ── 场景 E：中间页损坏 + Backups 有备份 + exe 旁留底 → 自愈而非 legacy 覆盖 ──
reset()
d = make_dir("E")
seed_db(os.path.join(d, "Save"), items=("stale.exe",))  # exe 旁陈旧留底
seed_db(os.path.join(FAKE_LOCAL, "TagLauncher", "Save"), items=("recent.exe",), with_backups=True)
corrupt_mid_page(local_db())
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items")
check("E 中间页损坏走自愈(非留底回退)", names == [("recent.exe",)], f"items={names}")

# ── 场景 F：Local 损坏 + 无备份 + exe 旁健康留底 → 不被覆盖 ──
reset()
d = make_dir("F")
seed_db(os.path.join(d, "Save"), items=("stale.exe",))
seed_db(os.path.join(FAKE_LOCAL, "TagLauncher", "Save"), items=("recent.exe",))  # 无 Backups
corrupt_mid_page(local_db())
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items")
check("F 无备份时不被留底回退覆盖", names != [("stale.exe",)], f"items={names}")

# ── 场景 G：Local 残骸（无 schema_version）+ exe 旁健康旧库 → legacy 覆盖残骸 ──
reset()
d = make_dir("G")
seed_db(os.path.join(d, "Save"), items=("old.exe",))
os.makedirs(os.path.dirname(local_db()))
sqlite3.connect(local_db()).execute(
    "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
).connection.close()
run_exe(d)
names = db_query(local_db(), "SELECT name FROM items")
check("G 残骸被健康旧库覆盖", names == [("old.exe",)], f"items={names}")

# ── 场景 H：datapath.json 重定向 → 用重定向，不迁移 ──
reset()
d = make_dir("H")
custom = os.path.join(SANDBOX, "H", "CustomData")
seed_db(custom, items=("custom.exe",))
with open(os.path.join(d, "datapath.json"), "w", encoding="utf-8") as f:
    json.dump({"save_dir": custom}, f)
run_exe(d)
check("H 重定向生效", db_query(os.path.join(custom, "taglauncher.db"), "SELECT name FROM items") == [("custom.exe",)])
check("H 未创建 Local 库", not os.path.exists(local_db()))

# ── 汇总 ──
print()
fails = [r for r in results if not r[1]]
print(f"==== {len(results) - len(fails)}/{len(results)} 场景通过 ====")
if fails:
    for name, _ in fails:
        print(f"  失败: {name}")
sys.exit(1 if fails else 0)
