mod v001_baseline;

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

/// 运行所有待执行的迁移
pub fn run_pending(conn: &Connection) -> Result<(), rusqlite::Error> {
    let migrations: Vec<Box<dyn Migration>> = vec![Box::new(v001_baseline::V001Baseline)];

    let current_version = get_schema_version(conn);

    for migration in &migrations {
        if migration.version() <= current_version {
            continue;
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
