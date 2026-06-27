mod v001_baseline;
mod v002_item_tag_position;
mod v003_performance_indexes;
mod v004_audio_type;
mod v005_object_identity;
mod v006_object_signature;
mod v007_tag_relations;

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
fn backup_before_breaking(conn: &Connection, version: u32) {
    let db_path = match conn.path() {
        Some(p) if !p.is_empty() && p != ":memory:" => p.to_string(),
        _ => return,
    };
    let backup_path = format!("{}.pre-v{}.bak", db_path, version);
    // VACUUM INTO 可安全快照在用连接的库（含尚未落盘的改动），且不能处于事务中——此处未开事务。
    let sql = format!("VACUUM INTO '{}'", backup_path.replace('\'', "''"));
    if let Err(e) = conn.execute_batch(&sql) {
        eprintln!(
            "[migrations] 破坏性迁移 v{} 前备份失败(已忽略, 继续升级): {}",
            version, e
        );
    }
}

/// 运行所有待执行的迁移
pub fn run_pending(conn: &Connection) -> Result<(), rusqlite::Error> {
    let migrations: Vec<Box<dyn Migration>> = vec![
        Box::new(v001_baseline::V001Baseline),
        Box::new(v002_item_tag_position::V002ItemTagPosition),
        Box::new(v003_performance_indexes::V003PerformanceIndexes),
        Box::new(v004_audio_type::V004AudioType),
        Box::new(v005_object_identity::V005ObjectIdentity),
        Box::new(v006_object_signature::V006ObjectSignature),
        Box::new(v007_tag_relations::V007TagRelations),
    ];

    let current_version = get_schema_version(conn);

    for migration in &migrations {
        if migration.version() <= current_version {
            continue;
        }

        // 破坏性迁移（重建表）前先对数据库做一次快照备份，作为最后的数据安全网。
        if migration.is_breaking() {
            backup_before_breaking(conn, migration.version());
        }

        migration.up(conn)?;
        record_migration(conn, migration.as_ref())?;
        set_schema_version(conn, migration.version())?;
    }

    // 记录当前应用版本
    let app_version = env!("CARGO_PKG_VERSION");
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('app_version', ?1)",
        [app_version],
    )?;

    Ok(())
}
