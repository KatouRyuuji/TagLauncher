//! 集成测试：扩展加载与安全校验（真实临时目录）。
//! 覆盖 discover_mods（合法 / 非法 id 载入期拒绝 / 缺 manifest 跳过 / 坏 JSON 报错）、
//! read_mod_entrypoint 目录逃逸防御、theme_loader 校验（缺 id / 保留 id 冲突）、
//! ensure_valid_mod_id（kv/record/file 命令共用的 id 校验）、resolve_mod_file_path 逃逸防御、
//! mod 专属数据表（mod_kv/mod_records）存取语义。

mod common;

use tag_launcher_lib::extensions::mod_registry::ModRegistry;
use tag_launcher_lib::extensions::{mod_loader, theme_loader};
use tag_launcher_lib::models::ModManifest;
use tag_launcher_lib::{ensure_valid_mod_id, reassess_dependency_compatibility, resolve_mod_file_path};

/// 在 mods 目录下写一个 mod 的 manifest.json。
fn write_manifest(mods_dir: &std::path::Path, sub: &str, json: &str) {
    let dir = mods_dir.join(sub);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("manifest.json"), json).unwrap();
}

const GOOD_MANIFEST: &str =
    r#"{"id":"goodmod","name":"Good","version":"1.0.0","author":"me","description":"d","type":"css"}"#;

/// discover_mods：合法 mod 收入结果；非法 id / 坏 JSON 进错误列表；缺 manifest 目录静默跳过。
#[test]
fn discover_mods_accepts_valid_and_rejects_invalid() {
    let root = common::TempDir::new("mods");
    let mods_dir = root.path.clone();

    write_manifest(&mods_dir, "goodmod", GOOD_MANIFEST);
    // 非法 id（含中文）→ 载入期即拒绝。
    write_manifest(
        &mods_dir,
        "badid",
        r#"{"id":"非法 id","name":"B","version":"1.0.0","author":"a","description":"d","type":"css"}"#,
    );
    // manifest.json 非法 JSON → 报错。
    write_manifest(&mods_dir, "badjson", "{ this is not json");
    // 无 manifest.json 的目录 → 静默跳过（不计入错误）。
    std::fs::create_dir_all(mods_dir.join("nomanifest")).unwrap();

    let (mods, errors) = mod_loader::discover_mods(&mods_dir);

    assert_eq!(mods.len(), 1, "仅一个合法 mod");
    assert_eq!(mods[0].0.id, "goodmod");

    let err_names: Vec<&str> = errors.iter().map(|e| e.dir_name.as_str()).collect();
    assert_eq!(errors.len(), 2, "非法 id 与坏 JSON 各一个错误");
    assert!(err_names.contains(&"badid"));
    assert!(err_names.contains(&"badjson"));
}

/// read_mod_entrypoint：正常入口可读；`../` 逃逸被拒。
#[test]
fn read_mod_entrypoint_blocks_directory_escape() {
    let root = common::TempDir::new("entry");
    let mods_dir = root.path.clone();
    write_manifest(&mods_dir, "goodmod", GOOD_MANIFEST);
    let mod_dir = mods_dir.join("goodmod");
    std::fs::write(mod_dir.join("entry.js"), "console.log('hi')").unwrap();
    // mods_dir 下（mod 目录之外）放一个真实文件，使 ../ 命中"逃逸"而非"未找到"分支。
    std::fs::write(mods_dir.join("outside.txt"), "secret").unwrap();

    // 正常入口。
    let content = mod_loader::read_mod_entrypoint(&mod_dir, "entry.js").expect("read entry");
    assert!(content.contains("hi"));

    // 逃逸到 mod 目录之外应被拒。
    assert!(
        mod_loader::read_mod_entrypoint(&mod_dir, "../outside.txt").is_err(),
        "../ 逃逸应被拒绝"
    );
}

/// theme_loader：合法主题收入；缺 id / 与保留内置 id 冲突进错误列表。
#[test]
fn load_custom_themes_validates_and_reports_errors() {
    let root = common::TempDir::new("themes");
    let themes_dir = root.path.clone();

    std::fs::write(
        themes_dir.join("good.json"),
        r##"{"id":"mytheme","name":"My","variables":{"accent-primary":"#fff"}}"##,
    )
    .unwrap();
    // 缺 id → 校验失败。
    std::fs::write(
        themes_dir.join("noid.json"),
        r#"{"id":"","name":"X","variables":{"a":"b"}}"#,
    )
    .unwrap();
    // 与内置保留 id 冲突。
    std::fs::write(
        themes_dir.join("reserved.json"),
        r#"{"id":"dark","name":"D","variables":{"a":"b"}}"#,
    )
    .unwrap();

    let result = theme_loader::load_custom_themes(&themes_dir);

    assert_eq!(result.themes.len(), 1, "仅一个合法主题");
    assert_eq!(result.themes[0].id, "mytheme");
    assert_eq!(result.errors.len(), 2, "缺 id 与保留 id 冲突各一个错误");
}

/// install_theme_file「源即目标」防御：从已安装的主题包目录再次导入同一主题，
/// 不得先删后拷（自删）；应跳过拷贝、直接重写 theme.json 完成再注册，目录内容保持完整。
#[test]
fn install_theme_from_own_installed_dir_does_not_self_delete() {
    let root = common::TempDir::new("theme-self");
    let themes_dir = root.path.clone();
    let pkg = themes_dir.join("mytheme");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(
        pkg.join("theme.json"),
        r##"{"id":"mytheme","name":"My","variables":{"accent-primary":"#fff"}}"##,
    )
    .unwrap();
    std::fs::write(pkg.join("extra.css"), "/* keep me */").unwrap();

    let result = theme_loader::install_theme_file(&themes_dir, &pkg).expect("reinstall in place");
    assert!(result.replaced, "对已安装主题再导入应报告 replaced");
    assert!(pkg.join("theme.json").exists(), "theme.json 应保留");
    assert_eq!(
        std::fs::read_to_string(pkg.join("extra.css")).unwrap(),
        "/* keep me */",
        "包内其它文件不应被删除"
    );
}

/// install_theme_file 祖先防御：把主题根目录本身（含 theme.json）当主题包导入，
/// 目标是其子目录，必须明确拒绝而非把根目录搬进子目录。
#[test]
fn install_theme_rejects_themes_root_as_source() {
    let root = common::TempDir::new("theme-root");
    let themes_dir = root.path.clone();
    // 在根目录直接放 theme.json，使其形态上可被当作"目录主题包"。
    std::fs::write(
        themes_dir.join("theme.json"),
        r##"{"id":"rootpkg","name":"R","variables":{"accent-primary":"#fff"}}"##,
    )
    .unwrap();

    let err = theme_loader::install_theme_file(&themes_dir, &themes_dir)
        .expect_err("主题根目录作为主题包应被拒绝");
    assert!(err.contains("父目录"), "错误应指出不能导入父目录: {}", err);
    assert!(themes_dir.join("theme.json").exists(), "源文件不应被动");
}

/// install_theme_file 嵌套防御：源在目标内（已安装主题包的子目录）时，
/// 替换式删除会连源一起删掉，必须明确拒绝。
#[test]
fn install_theme_rejects_nested_dir_inside_target() {
    let root = common::TempDir::new("theme-nested");
    let themes_dir = root.path.clone();
    let pkg = themes_dir.join("abc");
    let nested = pkg.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    // 外层已安装主题 abc；nested 子目录里的 theme.json id 也是 abc → 目标即外层目录。
    let manifest = r##"{"id":"abc","name":"A","variables":{"accent-primary":"#fff"}}"##;
    std::fs::write(pkg.join("theme.json"), manifest).unwrap();
    std::fs::write(nested.join("theme.json"), manifest).unwrap();

    let err = theme_loader::install_theme_file(&themes_dir, &nested)
        .expect_err("目标内的子目录作为源应被拒绝");
    assert!(err.contains("子目录"), "错误应指出不能导入子目录: {}", err);
    assert!(pkg.join("theme.json").exists(), "已安装主题不应被删");
    assert!(nested.join("theme.json").exists(), "源不应被删");
}

/// ensure_valid_mod_id：非空 / 长度 / 字符集 + 注册表存在性校验。
#[test]
fn ensure_valid_mod_id_enforces_rules_and_registration() {
    let root = common::TempDir::new("regmods");
    let mods_dir = root.path.clone();
    write_manifest(&mods_dir, "goodmod", GOOD_MANIFEST);
    let (mods, _errors) = mod_loader::discover_mods(&mods_dir);

    let registry = ModRegistry::new();
    for (m, p) in mods {
        registry.register(m, p, true, true, None);
    }

    // 合法且已注册 → Ok。
    assert!(ensure_valid_mod_id(&registry, "goodmod").is_ok());
    // 空 id → 拒。
    assert!(ensure_valid_mod_id(&registry, "").is_err());
    // 超长 id → 拒。
    assert!(ensure_valid_mod_id(&registry, &"a".repeat(200)).is_err());
    // 非法字符（中文 / 空格）→ 拒。
    assert!(ensure_valid_mod_id(&registry, "非法").is_err());
    assert!(ensure_valid_mod_id(&registry, "has space").is_err());
    // 合法字符但未注册 → 拒（not found）。
    assert!(ensure_valid_mod_id(&registry, "not.registered").is_err());
}

/// resolve_mod_file_path：正常相对路径可解析；`../` 与绝对路径被拒。
#[test]
fn resolve_mod_file_path_blocks_escape_and_absolute() {
    let root = common::TempDir::new("modfs");
    let mods_dir = root.path.clone();
    write_manifest(&mods_dir, "goodmod", GOOD_MANIFEST);
    let (mods, _errors) = mod_loader::discover_mods(&mods_dir);
    let registry = ModRegistry::new();
    let mod_dir = mods_dir.join("goodmod");
    for (m, p) in mods {
        registry.register(m, p, true, true, None);
    }

    // 正常相对路径（尚不存在的新文件）→ 解析为 mod 目录内路径。
    let ok = resolve_mod_file_path(&registry, "goodmod", "data/config.json").expect("resolve ok");
    assert!(ok.starts_with(mod_dir.canonicalize().unwrap()), "应落在 mod 目录内");

    // 目录逃逸 → 拒。
    assert!(resolve_mod_file_path(&registry, "goodmod", "../escape.txt").is_err());
    // 绝对路径 → 拒。
    assert!(resolve_mod_file_path(&registry, "goodmod", r"C:\Windows\system32\x.txt").is_err());
}

/// resolve_mod_file_path 符号链接防护：mod 目录内的 symlink 指向外部目录时，
/// 经链接写入新文件（目标尚不存在、走"组件校验"分支）也应被拒绝。
/// 无法创建 symlink 的环境（无开发者模式/管理员权限）跳过。
#[test]
fn resolve_mod_file_path_rejects_symlink_escape_for_new_file() {
    let root = common::TempDir::new("modlink");
    let mods_dir = root.path.join("mods");
    write_manifest(&mods_dir, "goodmod", GOOD_MANIFEST);
    let outside = root.path.join("outside");
    std::fs::create_dir_all(&outside).unwrap();

    let (mods, _errors) = mod_loader::discover_mods(&mods_dir);
    let registry = ModRegistry::new();
    for (m, p) in mods {
        registry.register(m, p, true, true, None);
    }

    // mod 目录内放一个指向外部目录的符号链接
    let link = mods_dir.join("goodmod").join("link");
    if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
        eprintln!("skip: 当前环境不允许创建目录符号链接（需开发者模式/管理员）");
        return;
    }

    // 经链接写新文件（link/new.txt 不存在）→ 应被拒绝
    assert!(
        resolve_mod_file_path(&registry, "goodmod", "link/new.txt").is_err(),
        "经符号链接逃逸到 mod 目录外应被拒绝"
    );
}

/// 启用依赖后重估：dependent 依赖 dependee；dependee 未启用时 dependent 被标依赖未满足，
/// dependee 启用并重估后 dependent 应即时恢复兼容（enable_mod 的运行期恢复路径）。
#[test]
fn reassess_recovers_dependents_after_dependency_enabled() {
    let registry = ModRegistry::new();
    let dependee: ModManifest = serde_json::from_str(
        r#"{"id":"dependee","name":"B","version":"1.2.0","author":"a","description":"d","type":"css"}"#,
    )
    .unwrap();
    let dependent: ModManifest = serde_json::from_str(
        r#"{"id":"dependent","name":"A","version":"1.0.0","author":"a","description":"d","type":"css",
            "dependencies":{"dependee":"^1.0.0"}}"#,
    )
    .unwrap();

    let root = common::TempDir::new("reassess");
    registry.register(dependee, root.path.join("dependee"), false, true, None);
    registry.register(
        dependent,
        root.path.join("dependent"),
        true,
        false,
        Some("依赖未满足：依赖 mod 'dependee' 未启用".to_string()),
    );

    // 依赖未启用时重估：不应恢复
    reassess_dependency_compatibility(&registry);
    let a = registry
        .list_mods()
        .into_iter()
        .find(|m| m.manifest.id == "dependent")
        .unwrap();
    assert!(!a.is_compatible, "依赖未启用时不应恢复兼容");

    // 启用依赖后重估：应即时恢复（无需重启）
    assert!(registry.enable_mod("dependee"));
    reassess_dependency_compatibility(&registry);
    let a = registry
        .list_mods()
        .into_iter()
        .find(|m| m.manifest.id == "dependent")
        .unwrap();
    assert!(a.is_compatible, "依赖启用后应恢复兼容");
    assert!(a.incompatible_reason.is_none(), "恢复后不应残留原因");

    // 版本不满足的依赖不应被恢复（重估仍判未满足）
    let dependent2: ModManifest = serde_json::from_str(
        r#"{"id":"dependent","name":"A","version":"1.0.0","author":"a","description":"d","type":"css",
            "dependencies":{"dependee":"^2.0.0"}}"#,
    )
    .unwrap();
    registry.register(
        dependent2,
        root.path.join("dependent"),
        true,
        false,
        Some("依赖未满足：依赖 mod 'dependee' 版本不满足（需要 ^2.0.0，实际 1.2.0）".to_string()),
    );
    reassess_dependency_compatibility(&registry);
    let a = registry
        .list_mods()
        .into_iter()
        .find(|m| m.manifest.id == "dependent")
        .unwrap();
    assert!(!a.is_compatible, "版本不满足时不应恢复兼容");
}

/// mod 专属数据表：mod_kv 上覆盖（INSERT OR REPLACE）、mod_records 按 updated_at 倒序列出。
#[test]
fn mod_data_tables_storage_semantics() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    // mod_kv：同 (mod_id,key) 二次写入应覆盖而非重复。
    conn.execute(
        "INSERT OR REPLACE INTO mod_kv (mod_id, key, value) VALUES ('m','k','v1')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO mod_kv (mod_id, key, value) VALUES ('m','k','v2')",
        [],
    )
    .unwrap();
    let (cnt, val): (i64, String) = conn
        .query_row(
            "SELECT COUNT(*), MAX(value) FROM mod_kv WHERE mod_id='m' AND key='k'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(cnt, 1, "同键应覆盖");
    assert_eq!(val, "v2");

    // mod_records：list 按 updated_at DESC 返回（后写的在前）。
    conn.execute(
        "INSERT INTO mod_records (mod_id, collection, id, value, updated_at) VALUES ('m','c','1','first', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO mod_records (mod_id, collection, id, value, updated_at) VALUES ('m','c','2','second', '2026-02-01 00:00:00')",
        [],
    )
    .unwrap();
    let ordered: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT value FROM mod_records WHERE mod_id='m' AND collection='c' ORDER BY updated_at DESC")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };
    assert_eq!(ordered, vec!["second".to_string(), "first".to_string()]);
}
