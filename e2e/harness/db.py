"""直接读写沙箱 SQLite（只在应用未运行时写；运行中只读）。"""
from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from pathlib import Path

from .paths import ROOT

SCHEMA_RS = ROOT / "src-tauri" / "src" / "db" / "schema.rs"


def current_schema_version() -> str:
    """应用当前 schema 版本 = 迁移目录里最大的 vNNN（新增迁移时断言随之更新，不再手改常量）。"""
    mig = ROOT / "src-tauri" / "src" / "db" / "migrations"
    nums = [int(m.group(1)) for f in mig.glob("v*.rs") if (m := re.match(r"v(\d+)_", f.name))]
    return str(max(nums))


def query(db: Path, sql: str, params=()) -> list[tuple]:
    uri = f"file:{db.as_posix()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True, timeout=5)) as con:
        return con.execute(sql, params).fetchall()


def scalar(db: Path, sql: str, params=()):
    rows = query(db, sql, params)
    return rows[0][0] if rows else None


def meta(db: Path, key: str) -> str | None:
    return scalar(db, "SELECT value FROM app_meta WHERE key=?", (key,))


def baseline_sql() -> str:
    text = SCHEMA_RS.read_text(encoding="utf-8")
    start = text.index("pub fn create_tables")
    m = re.search(r'r#"(.*?)"#', text[start:], re.S)
    return m.group(1)


def create_legacy_db(path: Path, schema_version: str = "14", items: list[tuple[str, str, str]] = (),
                     last_known_version: str | None = None, extra_meta: dict | None = None) -> Path:
    """用当前 create_tables 建表后把 schema_version 写成旧值，让应用跑一遍迁移（与 smoke 同法）。

    items: (name, path, type)
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as con:
        con.executescript(baseline_sql())
        con.execute("INSERT OR REPLACE INTO app_meta(key, value) VALUES('schema_version', ?)", (schema_version,))
        if last_known_version:
            con.execute("INSERT OR REPLACE INTO app_meta(key, value) VALUES('last_known_version', ?)",
                        (last_known_version,))
        for k, v in (extra_meta or {}).items():
            con.execute("INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)", (k, v))
        con.executemany("INSERT INTO items(name, path, type) VALUES(?, ?, ?)", list(items))
        con.commit()
    return path


def bulk_items(path: Path, n: int, root: str = "D:\\e2e-nonexistent") -> Path:
    items = [(f"项目{i:05d}", f"{root}\\item{i:05d}.txt", "text") for i in range(n)]
    return create_legacy_db(path, "20", items)
