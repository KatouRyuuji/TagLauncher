use rusqlite::Connection;

/// 读取设置值
pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// 写入设置值
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取应用版本
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// 获取当前主题 ID
pub fn get_current_theme(conn: &Connection) -> String {
    get_setting(conn, "theme").unwrap_or_else(|| "dark".to_string())
}

/// 设置当前主题
pub fn set_current_theme(conn: &Connection, theme_id: &str) -> Result<(), String> {
    set_setting(conn, "theme", theme_id)
}

/// 获取启用的 mod 列表
pub fn get_enabled_mods(conn: &Connection) -> Vec<String> {
    get_setting(conn, "enabled_mods")
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// 设置启用的 mod 列表
pub fn set_enabled_mods(conn: &Connection, mod_ids: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(mod_ids).map_err(|e| e.to_string())?;
    set_setting(conn, "enabled_mods", &json)
}
