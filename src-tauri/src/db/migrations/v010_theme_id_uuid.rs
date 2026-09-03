use super::Migration;
use rusqlite::Connection;

/// 内置主题 id uuid 化迁移（v1.7.0）：主题唯一标识与显示名/家族/功能语义解耦，
/// 统一改为固定 uuid。持久化在 app_meta.theme 的旧字符串 id 按下表改写：
///   "sakura"（霜靛·亮）          → 7f47aab2-…-550f0acf3c9c
///   "ryuuji-a1-dark"（霜靛·暗）  → 8cebf811-…-1d1fa685ce93
///   其余 a3/a4/a5/a6/b1/b3 亮暗各一，映射与 src/themes/ryuuji.ts DEFS 一致。
/// 本迁移运行于 v008/v009 之后，其输入 id 即前两迁移的输出 id。
///
/// 非破坏性：仅改写 app_meta 中 theme 设置的取值。
pub struct V010ThemeIdUuid;

impl Migration for V010ThemeIdUuid {
    fn version(&self) -> u32 {
        10
    }

    fn description(&self) -> &str {
        "Migrate preset theme ids to stable uuids"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            UPDATE app_meta SET value = '7f47aab2-74bb-4c77-b99b-550f0acf3c9c' WHERE key = 'theme' AND value = 'sakura';
            UPDATE app_meta SET value = '8cebf811-9b9d-4c49-ac9f-1d1fa685ce93' WHERE key = 'theme' AND value = 'ryuuji-a1-dark';
            UPDATE app_meta SET value = '668e5856-9d9f-481a-8f82-325372d2e256' WHERE key = 'theme' AND value = 'ryuuji-a3-light';
            UPDATE app_meta SET value = '65596bf6-3aaf-4322-93f2-bbb60cb94b5d' WHERE key = 'theme' AND value = 'ryuuji-a3-dark';
            UPDATE app_meta SET value = '3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2' WHERE key = 'theme' AND value = 'ryuuji-a4-light';
            UPDATE app_meta SET value = 'cd4665e5-081f-434b-943f-bd44b49cd6ac' WHERE key = 'theme' AND value = 'ryuuji-a4-dark';
            UPDATE app_meta SET value = '6794e521-fd01-4e6d-997a-c4d0f1c66de2' WHERE key = 'theme' AND value = 'ryuuji-a5-light';
            UPDATE app_meta SET value = 'f2368e2a-ee19-4192-96ea-3db85f15c74d' WHERE key = 'theme' AND value = 'ryuuji-a5-dark';
            UPDATE app_meta SET value = '70492696-751c-4a29-9ab4-09ad8ddff1a4' WHERE key = 'theme' AND value = 'ryuuji-a6-light';
            UPDATE app_meta SET value = 'ad9b379f-0f3d-45e3-8b55-bf077b4ab97a' WHERE key = 'theme' AND value = 'ryuuji-a6-dark';
            UPDATE app_meta SET value = 'e0f5add7-8b67-42c9-9b2b-c7bbf49e255d' WHERE key = 'theme' AND value = 'ryuuji-b1-light';
            UPDATE app_meta SET value = '6c309a70-ec6a-4429-8299-c4cde7c0ffcc' WHERE key = 'theme' AND value = 'ryuuji-b1-dark';
            UPDATE app_meta SET value = '5298ac16-455f-42f8-8bc8-e9b03ee0fdbf' WHERE key = 'theme' AND value = 'ryuuji-b3-light';
            UPDATE app_meta SET value = 'cfaadcb4-7e85-460c-a8fe-52e848959719' WHERE key = 'theme' AND value = 'ryuuji-b3-dark';
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
    fn legacy_string_ids_map_to_uuids() {
        let cases = [
            ("sakura", "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"),
            ("ryuuji-a1-dark", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
            ("ryuuji-a3-light", "668e5856-9d9f-481a-8f82-325372d2e256"),
            ("ryuuji-a3-dark", "65596bf6-3aaf-4322-93f2-bbb60cb94b5d"),
            ("ryuuji-a4-light", "3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2"),
            ("ryuuji-a4-dark", "cd4665e5-081f-434b-943f-bd44b49cd6ac"),
            ("ryuuji-a5-light", "6794e521-fd01-4e6d-997a-c4d0f1c66de2"),
            ("ryuuji-a5-dark", "f2368e2a-ee19-4192-96ea-3db85f15c74d"),
            ("ryuuji-a6-light", "70492696-751c-4a29-9ab4-09ad8ddff1a4"),
            ("ryuuji-a6-dark", "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a"),
            ("ryuuji-b1-light", "e0f5add7-8b67-42c9-9b2b-c7bbf49e255d"),
            ("ryuuji-b1-dark", "6c309a70-ec6a-4429-8299-c4cde7c0ffcc"),
            ("ryuuji-b3-light", "5298ac16-455f-42f8-8bc8-e9b03ee0fdbf"),
            ("ryuuji-b3-dark", "cfaadcb4-7e85-460c-a8fe-52e848959719"),
        ];
        for (old, expected) in cases {
            let conn = setup();
            conn.execute("INSERT INTO app_meta VALUES ('theme', ?1)", [old])
                .unwrap();
            V010ThemeIdUuid.up(&conn).expect("migration");
            assert_eq!(theme(&conn), expected, "旧 id {old} 应映射为 {expected}");
        }
    }

    #[test]
    fn uuid_and_unrelated_keys_untouched() {
        let conn = setup();
        conn.execute_batch(
            "INSERT INTO app_meta VALUES ('theme', '7f47aab2-74bb-4c77-b99b-550f0acf3c9c');
             INSERT INTO app_meta VALUES ('ai.model', 'sakura');",
        )
        .unwrap();
        V010ThemeIdUuid.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "7f47aab2-74bb-4c77-b99b-550f0acf3c9c");
        let ai_model: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'ai.model'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ai_model, "sakura", "非 theme 键即使值同名也不得改写");
    }
}
