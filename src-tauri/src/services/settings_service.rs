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

/// 获取启用的 mod 列表。
/// 返回 (mod_ids, error)。
///   - 键不存在（全新安装）→ ([], None)
///   - 解析失败（数据损坏）→ ([], Some(错误信息))  — 返回空列表但记录错误，不静默误禁所有 mod
pub fn get_enabled_mods(conn: &Connection) -> (Vec<String>, Option<String>) {
    match get_setting(conn, "enabled_mods") {
        None => (Vec::new(), None),
        Some(s) if s.trim().is_empty() => (Vec::new(), None),
        Some(s) => match serde_json::from_str::<Vec<String>>(&s) {
            Ok(v) => (v, None),
            Err(e) => (
                Vec::new(),
                Some(format!(
                    "enabled_mods 字段解析失败（数据已损坏，已重置为空列表）: {}",
                    e
                )),
            ),
        },
    }
}

/// 设置启用的 mod 列表
pub fn set_enabled_mods(conn: &Connection, mod_ids: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(mod_ids).map_err(|e| e.to_string())?;
    set_setting(conn, "enabled_mods", &json)
}
