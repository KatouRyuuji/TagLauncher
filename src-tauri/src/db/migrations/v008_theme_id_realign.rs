use super::Migration;
use rusqlite::Connection;

/// 内置主题 id 对调归位（v1.6.1）：
///   - 旧 "sakura"（实为深色·赛博青）→ "cyber-cyan"
///   - 旧 "light"（实为亮色·樱花）  → "sakura"
/// 两条 UPDATE 的顺序必须保持：先把旧 "sakura" 改写为 "cyber-cyan"，
/// 再把旧 "light" 改写为 "sakura"——反序会把已归位的 cyber-cyan 之外的
/// 旧 sakura 行与旧 light 行混为同一目标，产生错误的级联改写。
///
/// 非破坏性：仅改写 app_meta 中 theme 设置的取值，老用户的主题选择自动落到
/// 与升级前完全相同的视觉主题上。
pub struct V008ThemeIdRealign;

impl Migration for V008ThemeIdRealign {
    fn version(&self) -> u32 {
        8
    }

    fn description(&self) -> &str {
        "Realign preset theme ids (sakura->cyber-cyan, light->sakura)"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            UPDATE app_meta SET value = 'cyber-cyan' WHERE key = 'theme' AND value = 'sakura';
            UPDATE app_meta SET value = 'sakura'     WHERE key = 'theme' AND value = 'light';
            "#,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);")
            .expect("create app_meta");
        conn
    }

    fn theme(conn: &Connection) -> String {
        conn.query_row("SELECT value FROM app_meta WHERE key = 'theme'", [], |r| r.get(0))
            .expect("read theme")
    }

    #[test]
    fn legacy_sakura_maps_to_cyber_cyan() {
        let conn = setup();
        conn.execute("INSERT INTO app_meta VALUES ('theme', 'sakura')", [])
            .unwrap();
        V008ThemeIdRealign.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "cyber-cyan");
    }

    #[test]
    fn legacy_light_maps_to_sakura() {
        let conn = setup();
        conn.execute("INSERT INTO app_meta VALUES ('theme', 'light')", [])
            .unwrap();
        V008ThemeIdRealign.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "sakura");
    }

    #[test]
    fn new_ids_and_unrelated_keys_untouched() {
        let conn = setup();
        conn.execute_batch(
            "INSERT INTO app_meta VALUES ('theme', 'dark');
             INSERT INTO app_meta VALUES ('ai.model', 'sakura');
             INSERT INTO app_meta VALUES ('last_known_version', '1.6.0-beta');",
        )
        .unwrap();
        V008ThemeIdRealign.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "dark");
        let ai_model: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'ai.model'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ai_model, "sakura", "非 theme 键即使值同名也不得改写");
    }
}
