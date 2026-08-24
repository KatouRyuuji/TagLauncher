mod v001_baseline;
mod v002_item_tag_position;
mod v003_performance_indexes;
mod v004_audio_type;
mod v005_object_identity;
mod v006_object_signature;
mod v007_tag_relations;
mod v008_theme_id_realign;

use rusqlite::Connection;

/// 迁移 trait：每个版本升级实现此接口
pub trait Migration {
    fn version(&self) -> u32;
    fn description(&self) -> &str;
    fn is_breaking(&self) -> bool {
        false
    }
    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error>;
}

/// 获取当前 schema 版本
fn get_schema_version(conn: &Connection) -> u32 {
    // 检查 app_meta 表是否存在
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_meta'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !table_exists {
        return 0;
    }

    conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'schema_version'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse::<u32>().ok())
    .unwrap_or(0)
}

/// 设置 schema 版本
fn set_schema_version(conn: &Connection, version: u32) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?1)",
        [version.to_string()],
    )?;
    Ok(())
}

fn record_migration(conn: &Connection, migration: &dyn Migration) -> Result<(), rusqlite::Error> {
    let prefix = format!("migration::{}", migration.version());
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)",
        [format!("{}::description", prefix), migration.description().to_string()],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)",
        [format!("{}::is_breaking", prefix), migration.is_breaking().to_string()],
    )?;
    Ok(())
}

/// 破坏性迁移（重建表）前对数据库做一次快照备份。
/// best-effort：内存库无路径则跳过；备份失败仅记录日志、不阻断升级
///（迁移本身在事务内执行，失败会整体回滚，备份是额外的安全网）。
/// 成功时返回备份文件路径（供清理旧备份时豁免本轮新建的备份）。
fn backup_before_breaking(conn: &Connection, version: u32) -> Option<String> {
    let db_path = match conn.path() {
        Some(p) if !p.is_empty() && p != ":memory:" => p.to_string(),
        _ => return None,
    };
    let backup_path = format!("{}.pre-v{}.bak", db_path, version);
    // VACUUM INTO 可安全快照在用连接的库（含尚未落盘的改动），且不能处于事务中——此处未开事务。
    let sql = format!("VACUUM INTO '{}'", backup_path.replace('\'', "''"));
    match conn.execute_batch(&sql) {
        Ok(_) => Some(backup_path),
        Err(e) => {
            eprintln!(
                "[migrations] 破坏性迁移 v{} 前备份失败(已忽略, 继续升级): {}",
                version, e
            );
            None
        }
    }
}

/// 判断库中是否已有用户数据（items 非空）。
/// 用于避免在全新空库上做无意义的破坏性迁移备份（空库无数据可丢）。
fn db_has_user_data(conn: &Connection) -> bool {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM items)", [], |r| r.get::<_, i64>(0))
        .map(|v| v != 0)
        .unwrap_or(false)
}

/// 破坏性迁移备份保留策略：清理同目录下 `<db>.pre-v*.bak` 历史备份，但——
/// ① `keep`（本轮新建）一律保留：多破坏性迁移连跳（如 v1→v4→v5）会产生多份，
///    其中最早一份是"升级前原始态"，是最有价值的回滚点，不能按 mtime 只留最新；
/// ② 历史（非本轮）备份仅保留最新一份，避免跨版本累积。
/// best-effort：内存库/无路径则跳过；单个删除失败仅记日志、不阻断。
fn prune_old_breaking_backups(conn: &Connection, keep: &[String]) {
    let db_path = match conn.path() {
        Some(p) if !p.is_empty() && p != ":memory:" => p.to_string(),
        _ => return,
    };
    let db_path = std::path::Path::new(&db_path);
    let (dir, file_name) = match (
        db_path.parent(),
        db_path.file_name().and_then(|s| s.to_str()),
    ) {
        (Some(d), Some(f)) => (d, f.to_string()),
        _ => return,
    };
    let prefix = format!("{}.pre-v", file_name);
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    let mut backups: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && name.ends_with(".bak") {
            if let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) {
                backups.push((mtime, entry.path()));
            }
        }
    }
    // 分出本轮新建（一律保留）与历史备份；历史备份仅留最新一份，删除其余。
    let mut historical: Vec<(std::time::SystemTime, std::path::PathBuf)> = backups
        .into_iter()
        .filter(|(_, p)| !keep.iter().any(|k| k == &p.to_string_lossy()))
        .collect();
    if historical.len() <= 1 {
        return;
    }
    historical.sort_by_key(|(t, _)| *t);
    for (_, path) in historical.iter().take(historical.len() - 1) {
        if let Err(e) = std::fs::remove_file(path) {
            eprintln!("[migrations] 清理旧破坏性备份失败 {:?}: {}", path, e);
        }
    }
}

/// 运行所有待执行的迁移。
///
/// 每个迁移的「执行 up() + 记录元数据 + 推进版本号」被包进单个事务，整体提交或整体回滚，
/// 消除"迁移已应用但版本号未推进"的中间态。破坏性迁移（重建 items 表）的两项前置工作
/// 必须在事务外完成：① VACUUM INTO 快照备份（不能在事务中，且仅在库已有数据时才做）；
/// ② 关闭外键强制——重建时 `DROP TABLE items` 若开着外键会级联删除 item_tags/cabinet_items
/// 关联，而外键 PRAGMA 在事务内为 no-op，故须在 BEGIN 之前关闭、COMMIT 之后恢复
/// （SQLite 表重定义标准做法）。因此各破坏性迁移自身不再自开 BEGIN / 设置外键 PRAGMA。
pub fn run_pending(conn: &Connection) -> Result<(), rusqlite::Error> {
    let migrations: Vec<Box<dyn Migration>> = vec![
        Box::new(v001_baseline::V001Baseline),
        Box::new(v002_item_tag_position::V002ItemTagPosition),
        Box::new(v003_performance_indexes::V003PerformanceIndexes),
        Box::new(v004_audio_type::V004AudioType),
        Box::new(v005_object_identity::V005ObjectIdentity),
        Box::new(v006_object_signature::V006ObjectSignature),
        Box::new(v007_tag_relations::V007TagRelations),
        Box::new(v008_theme_id_realign::V008ThemeIdRealign),
    ];

    let current_version = get_schema_version(conn);
    // 本轮新建的全部破坏性备份路径（清理旧备份时豁免，保留"升级前原始态"回滚点）。
    let mut backups_this_run: Vec<String> = Vec::new();

    for migration in &migrations {
        if migration.version() <= current_version {
            continue;
        }

        let manage_fk = migration.is_breaking();

        // 破坏性迁移前置（均在事务外）：仅当库已有用户数据时快照备份；随后关闭外键强制。
        if migration.is_breaking() && db_has_user_data(conn) {
            if let Some(p) = backup_before_breaking(conn, migration.version()) {
                backups_this_run.push(p);
            }
        }
        if manage_fk {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        }

        // 执行迁移 + 记录元数据 + 推进版本号：单事务原子完成（unchecked：仅持 &Connection）。
        // 用闭包收敛结果，确保 foreign_keys 在**失败路径也能恢复**——UP 失败时 tx 随 Drop
        // 回滚，外键 PRAGMA 必须在事务结束后重新开启，避免连接在外键关闭状态下继续使用。
        let result: Result<(), rusqlite::Error> = (|| {
            let tx = conn.unchecked_transaction()?;
            migration.up(&tx)?;
            record_migration(&tx, migration.as_ref())?;
            set_schema_version(&tx, migration.version())?;
            tx.commit()
        })();

        // 恢复外键强制（表重定义标准做法：事务结束之后；成败都要恢复）。
        if manage_fk {
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        }
        result?;
    }

    // 破坏性备份清理：本轮新建的全保留，历史仅留最新一份。
    prune_old_breaking_backups(conn, &backups_this_run);

    // 记录当前应用版本
    let app_version = env!("CARGO_PKG_VERSION");
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('app_version', ?1)",
        [app_version],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// 模拟 v4 老库（schema_version=4，无身份列），且 item_tags/cabinet_items 带 ON DELETE CASCADE
    /// 外键与真实关联数据，连接开启外键强制——用于验证破坏性重建不会级联清空关联。
    fn seed_v4_with_cascading_relations(conn: &Connection) {
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE items (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
                type TEXT CHECK(type IN ('folder','image','audio','exe','bat','ps1')),
                icon_path TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME, is_favorite INTEGER DEFAULT 0
            );
            CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
            CREATE TABLE item_tags (
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (item_id, tag_id)
            );
            CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT, created_at DATETIME);
            CREATE TABLE cabinet_items (
                cabinet_id INTEGER REFERENCES cabinets(id) ON DELETE CASCADE,
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                PRIMARY KEY (cabinet_id, item_id)
            );
            CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE VIRTUAL TABLE items_fts USING fts5(name, path, content=items, content_rowid=id);
            INSERT INTO app_meta (key, value) VALUES ('schema_version','4');
            INSERT INTO items (id, name, path, type) VALUES (1,'a','D:\a.exe','exe');
            INSERT INTO tags (id, name, color) VALUES (1,'t','#fff');
            INSERT INTO item_tags (item_id, tag_id, position) VALUES (1,1,0);
            INSERT INTO cabinets (id, name, color) VALUES (1,'c','#fff');
            INSERT INTO cabinet_items (cabinet_id, item_id) VALUES (1,1);
            "#,
        )
        .expect("seed v4 with cascading relations");
    }

    /// 破坏性迁移（v005 重建 items 表）在外键开启的连接上运行时：
    /// - 框架应在事务外关闭外键，避免 DROP TABLE items 级联删除 item_tags/cabinet_items 关联；
    /// - 迁移 up() + 版本推进在单事务内原子完成，最终版本到 7；
    /// - 迁移结束后外键强制恢复为开启。
    #[test]
    fn breaking_rebuild_preserves_relations_and_bumps_version_atomically() {
        let conn = Connection::open_in_memory().expect("open");
        seed_v4_with_cascading_relations(&conn);

        run_pending(&conn).expect("run_pending upgrade");

        assert_eq!(get_schema_version(&conn), 8, "版本应推进到最新");

        let it: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(it, 1, "item_tags 关联应在破坏性重建后存活（外键在事务外被关闭）");
        let ci: i64 = conn
            .query_row("SELECT COUNT(*) FROM cabinet_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ci, 1, "cabinet_items 关联应存活");

        let cols: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('items') WHERE name IN ('file_id','is_missing','volume_serial')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cols, 3, "身份列应补齐");

        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1, "迁移后应恢复外键强制");
    }

    /// 幂等：已在最新版本的库再次 run_pending 不应报错、版本不变、数据无损。
    #[test]
    fn rerun_on_current_version_is_idempotent() {
        let conn = Connection::open_in_memory().expect("open");
        seed_v4_with_cascading_relations(&conn);
        run_pending(&conn).expect("first upgrade");
        // 再跑一次（current_version 已是 8，全部跳过）
        run_pending(&conn).expect("idempotent rerun");
        assert_eq!(get_schema_version(&conn), 8);
        let it: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(it, 1);
    }
}
