use super::Migration;
use rusqlite::Connection;

/// 内置主题下架：只保留霜靛 / 藤色 / 樱花 / 素墨（均为纸面语言）。
/// 已持久化的旧主题 id 改写到同亮暗、气质最近的在架主题。
pub struct V013RetireThemeFamilies;

impl Migration for V013RetireThemeFamilies {
    fn version(&self) -> u32 {
        13
    }

    fn description(&self) -> &str {
        "Retire willow/teal/instrument palettes; remap persisted theme ids"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            UPDATE app_meta SET value = '7f47aab2-74bb-4c77-b99b-550f0acf3c9c' WHERE key = 'theme' AND value = '3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2';
            UPDATE app_meta SET value = '8cebf811-9b9d-4c49-ac9f-1d1fa685ce93' WHERE key = 'theme' AND value = 'cd4665e5-081f-434b-943f-bd44b49cd6ac';
            UPDATE app_meta SET value = '7f47aab2-74bb-4c77-b99b-550f0acf3c9c' WHERE key = 'theme' AND value = '6794e521-fd01-4e6d-997a-c4d0f1c66de2';
            UPDATE app_meta SET value = '8cebf811-9b9d-4c49-ac9f-1d1fa685ce93' WHERE key = 'theme' AND value = 'f2368e2a-ee19-4192-96ea-3db85f15c74d';
            UPDATE app_meta SET value = '7f47aab2-74bb-4c77-b99b-550f0acf3c9c' WHERE key = 'theme' AND value = 'e0f5add7-8b67-42c9-9b2b-c7bbf49e255d';
            UPDATE app_meta SET value = '8cebf811-9b9d-4c49-ac9f-1d1fa685ce93' WHERE key = 'theme' AND value = '6c309a70-ec6a-4429-8299-c4cde7c0ffcc';
            UPDATE app_meta SET value = '70492696-751c-4a29-9ab4-09ad8ddff1a4' WHERE key = 'theme' AND value = '5298ac16-455f-42f8-8bc8-e9b03ee0fdbf';
            UPDATE app_meta SET value = 'ad9b379f-0f3d-45e3-8b55-bf077b4ab97a' WHERE key = 'theme' AND value = 'cfaadcb4-7e85-460c-a8fe-52e848959719';
            UPDATE app_meta SET value = 'f04d4499-8a9c-4c84-b7d1-73574fc98f9e' WHERE key = 'theme' AND value = '54a0eaae-9c92-4f4a-b823-b0a33f940bd3';
            UPDATE app_meta SET value = '2db7495f-a084-4f7d-ae6d-d06258dc0e3c' WHERE key = 'theme' AND value = 'c3d01915-3266-4c53-b8ad-badc8089752b';
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
            ("3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2", "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"),
            ("cd4665e5-081f-434b-943f-bd44b49cd6ac", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
            ("6794e521-fd01-4e6d-997a-c4d0f1c66de2", "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"),
            ("f2368e2a-ee19-4192-96ea-3db85f15c74d", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
            ("e0f5add7-8b67-42c9-9b2b-c7bbf49e255d", "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"),
            ("6c309a70-ec6a-4429-8299-c4cde7c0ffcc", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
            ("5298ac16-455f-42f8-8bc8-e9b03ee0fdbf", "70492696-751c-4a29-9ab4-09ad8ddff1a4"),
            ("cfaadcb4-7e85-460c-a8fe-52e848959719", "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a"),
            ("54a0eaae-9c92-4f4a-b823-b0a33f940bd3", "f04d4499-8a9c-4c84-b7d1-73574fc98f9e"),
            ("c3d01915-3266-4c53-b8ad-badc8089752b", "2db7495f-a084-4f7d-ae6d-d06258dc0e3c"),
        ];
        for (old, expected) in cases {
            let conn = setup();
            conn.execute("INSERT INTO app_meta VALUES ('theme', ?1)", [old])
                .unwrap();
            V013RetireThemeFamilies.up(&conn).expect("migration");
            assert_eq!(theme(&conn), expected, "旧 id {old} 应映射为 {expected}");
        }
    }

    #[test]
    fn surviving_ids_untouched() {
        let conn = setup();
        conn.execute_batch(
            "INSERT INTO app_meta VALUES ('theme', '7f47aab2-74bb-4c77-b99b-550f0acf3c9c');
             INSERT INTO app_meta VALUES ('ai.model', '3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2');",
        )
        .unwrap();
        V013RetireThemeFamilies.up(&conn).expect("migration");
        assert_eq!(theme(&conn), "7f47aab2-74bb-4c77-b99b-550f0acf3c9c");
        let ai_model: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'ai.model'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ai_model, "3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2");
    }
}
