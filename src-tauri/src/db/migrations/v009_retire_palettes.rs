use super::Migration;
use rusqlite::Connection;

/// 内置主题下架迁移（v1.7.0）：和红（a2）、钢青（b2）、青柠（b4）色板移除，
/// 持久化在 app_meta.theme 的旧主题 id 改写为视觉气质最接近的在架主题：
///   - "dark"（深色·和红）        → "ryuuji-a6-dark"（深色·樱花，同红色系）
///   - "cyber-cyan"（深色·钢青）  → "ryuuji-b1-dark"（深色·海军冰蓝，同蓝色仪器系）
///   - "ryuuji-a2-light"          → "ryuuji-a6-light"（亮色·樱花）
///   - "ryuuji-b2-light"          → "ryuuji-b1-light"（亮色·海军冰蓝）
///   - "ryuuji-b4-light"/"dark"   → "ryuuji-a4-light"/"dark"（柳染，同绿色系）
///
/// 非破坏性：仅改写 app_meta 中 theme 设置的取值。
pub struct V009RetirePalettes;

impl Migration for V009RetirePalettes {
    fn version(&self) -> u32 {
        9
    }

    fn description(&self) -> &str {
        "Retire a2/b2/b4 palettes, remap persisted theme ids"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            UPDATE app_meta SET value = 'ryuuji-a6-dark'  WHERE key = 'theme' AND value = 'dark';
            UPDATE app_meta SET value = 'ryuuji-b1-dark'  WHERE key = 'theme' AND value = 'cyber-cyan';
            UPDATE app_meta SET value = 'ryuuji-a6-light' WHERE key = 'theme' AND value = 'ryuuji-a2-light';
            UPDATE app_meta SET value = 'ryuuji-b1-light' WHERE key = 'theme' AND value = 'ryuuji-b2-light';
            UPDATE app_meta SET value = 'ryuuji-a4-light' WHERE key = 'theme' AND value = 'ryuuji-b4-light';
            UPDATE app_meta SET value = 'ryuuji-a4-dark'  WHERE key = 'theme' AND value = 'ryuuji-b4-dark';
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
    fn retired_ids_map_to_closest_survivors() {
        let cases = [
            ("dark", "ryuuji-a6-dark"),
            ("cyber-cyan", "ryuuji-b1-dark"),
            ("ryuuji-a2-light", "ryuuji-a6-light"),
            ("ryuuji-b2-light", "ryuuji-b1-light"),
            ("ryuuji-b4-light", "ryuuji-a4-light"),
            ("ryuuji-b4-dark", "ryuuji-a4-dark"),
        ];
        for (old, expected) in cases {
            let conn = setup();
            conn.execute("INSERT INTO app_meta VALUES ('theme', ?1)", [old])
                .unwrap();
            V009RetirePalettes.up(&conn).expect("migration");
            assert_eq!(theme(&conn), expected, "旧 id {old} 应映射为 {expected}");
        }
    }

    #[test]
    fn surviving_ids_and_unrelated_keys_untouched() {
        let conn = setup();
        conn.execute_batch(
            "INSERT INTO app_meta VALUES ('theme', 'sakura');
             INSERT INTO app_meta VALUES ('ai.model', 'dark');
             INSERT INTO app_meta VALUES ('last_known_version', '1.6.3-beta');",
        )
        .unwrap();
        V009RetirePalettes.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "sakura");
        let ai_model: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'ai.model'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ai_model, "dark", "非 theme 键即使值同名也不得改写");
    }
}
