// ============================================================================
// commands.rs — Tauri 命令实现
// ============================================================================
// 所有前端通过 invoke() 调用的后端命令都在此文件中定义。
// 每个命令函数标注 #[tauri::command]，由 lib.rs 中的 generate_handler! 宏注册。
//
// 命令分为 6 大类：
// 1. 项目 CRUD（add_item, remove_item, get_items, toggle_favorite）
// 2. 标签管理（get_tags, add_tag, update_tag, remove_tag, set_item_tags）
// 3. 搜索（search_items）
// 4. 启动/打开（launch_item, open_in_explorer）
// 5. 同义词（read_synonyms）
// 6. 文件柜（get_cabinets, add_cabinet, update_cabinet, remove_cabinet,
//           add_item_to_cabinet, remove_item_from_cabinet, get_cabinet_items）
// ============================================================================

use crate::db::Database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 项目（文件/文件夹）数据结构
/// 与前端 TypeScript 的 Item 接口一一对应
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub path: String,
    /// 使用 #[serde(rename)] 将 Rust 的 item_type 序列化为 JSON 的 "type"
    /// 因为 "type" 是 Rust 关键字，不能直接用作字段名
    #[serde(rename = "type")]
    pub item_type: String,
    pub icon_path: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub is_favorite: bool,
}

/// 标签数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
}

/// 文件柜数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cabinet {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

/// 带标签的项目（用于前端展示）
/// #[serde(flatten)] 将 item 的字段展开到同一层级
/// JSON 输出：{ "id": 1, "name": "...", "tags": [...] }
/// 而不是：{ "item": { "id": 1, ... }, "tags": [...] }
#[derive(Debug, Serialize, Deserialize)]
pub struct ItemWithTags {
    #[serde(flatten)]
    pub item: Item,
    pub tags: Vec<Tag>,
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 从数据库行映射为 Item 结构体
/// 列顺序必须与 ITEM_COLS 常量一致：
/// id, name, path, type, icon_path, created_at, last_used_at, is_favorite
fn item_from_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    // is_favorite 在数据库中存储为 INTEGER (0/1)，需要转换为 bool
    let fav: i64 = row.get(7)?;
    Ok(Item {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        item_type: row.get(3)?,
        icon_path: row.get(4)?,
        created_at: row.get(5)?,
        last_used_at: row.get(6)?,
        is_favorite: fav != 0,
    })
}

/// SELECT 查询中使用的列名常量，确保所有查询的列顺序一致
const ITEM_COLS: &str = "id, name, path, type, icon_path, created_at, last_used_at, is_favorite";

/// 默认排序规则：收藏优先 → 最近使用 → 名称字母序
const ITEM_ORDER: &str = "is_favorite DESC, last_used_at DESC NULLS LAST, name";

/// 根据文件路径自动检测类型
/// - 目录 → "folder"
/// - 常见图片 → "image"
/// - .exe → "exe"
/// - .bat/.cmd → "bat"
/// - .ps1 → "ps1"
/// - 其他 → 默认 "exe"
fn detect_type(path: &str) -> &'static str {
    const IMAGE_EXTS: &[&str] = &[
        "png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic",
        "heif",
    ];

    let p = Path::new(path);
    if p.is_dir() {
        return "folder";
    }
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some(ext) if IMAGE_EXTS.contains(&ext) => "image",
        Some("exe") => "exe",
        Some("bat") | Some("cmd") => "bat",
        Some("ps1") => "ps1",
        _ => "exe",
    }
}

/// 从完整路径中提取文件/文件夹名
/// 例如：`C:\Games\Steam.exe` → `Steam.exe`
fn get_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// 查询指定项目关联的所有标签
fn get_item_tags(conn: &rusqlite::Connection, item_id: i64) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color FROM tags t
         INNER JOIN item_tags it ON t.id = it.tag_id
         WHERE it.item_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([item_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|e| e.to_string())?);
    }
    Ok(tags)
}

/// 批量为项目列表附加标签信息
/// 将 Vec<Item> 转换为 Vec<ItemWithTags>
fn items_with_tags(
    conn: &rusqlite::Connection,
    items: Vec<Item>,
) -> Result<Vec<ItemWithTags>, String> {
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let tags = get_item_tags(conn, item.id)?;
        result.push(ItemWithTags { item, tags });
    }
    Ok(result)
}

/// 判断 icon_path 是否包含有效内容
fn has_icon_path(item: &Item) -> bool {
    item.icon_path
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

/// 计算单个对象的“自动缩略图/图标”路径：
/// - 图片对象：直接使用对象自身路径作为缩略图
/// - 其他对象（Windows）：尝试提取系统关联图标到缓存目录
fn auto_visual_path(app: &AppHandle, item: &Item) -> Option<String> {
    if item.item_type == "image" {
        return Some(item.path.clone());
    }

    #[cfg(target_os = "windows")]
    {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .or_else(|_| app.path().app_data_dir())
            .unwrap_or_else(|_| std::env::temp_dir().join("taglauncher"))
            .join("item-icons");
        std::fs::create_dir_all(&cache_dir).ok()?;

        let cached_path = icon_cache_path(&cache_dir, &item.path);
        if cached_path.exists() {
            return Some(cached_path.to_string_lossy().to_string());
        }

        if extract_associated_icon_to_png(&item.path, &cached_path).ok()? {
            return Some(cached_path.to_string_lossy().to_string());
        }
    }

    None
}

/// 为项目列表补齐自动可视路径：
/// 仅在未设置自定义 icon_path 时生效，不会覆盖用户自定义缩略图。
fn fill_auto_visual_paths(app: &AppHandle, items: &mut [Item]) {
    for item in items.iter_mut() {
        if has_icon_path(item) {
            continue;
        }
        if let Some(auto_path) = auto_visual_path(app, item) {
            item.icon_path = Some(auto_path);
        }
    }
}

#[cfg(target_os = "windows")]
fn icon_cache_path(cache_dir: &Path, input_path: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    input_path.to_lowercase().hash(&mut hasher);

    if let Ok(meta) = std::fs::metadata(input_path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                duration.as_secs().hash(&mut hasher);
            }
        }
    }

    cache_dir.join(format!("{:016x}.png", hasher.finish()))
}

#[cfg(target_os = "windows")]
fn extract_associated_icon_to_png(input_path: &str, output_path: &Path) -> Result<bool, String> {
    let in_path = input_path.replace('\'', "''");
    let out_path = output_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
$in = '{in_path}';
$out = '{out_path}';
Add-Type -AssemblyName System.Drawing;
try {{
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($in);
  if ($null -eq $icon) {{ exit 2 }}
  $bmp = $icon.ToBitmap();
  $dir = [System.IO.Path]::GetDirectoryName($out);
  if (-not [string]::IsNullOrWhiteSpace($dir)) {{
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
  }}
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png);
  $bmp.Dispose();
  $icon.Dispose();
  exit 0
}} catch {{
  exit 1
}}
"#
    );

    let status = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .status()
        .map_err(|e| e.to_string())?;

    Ok(status.success() && output_path.exists())
}

// ============================================================================
// 项目 CRUD 命令
// ============================================================================

/// 添加项目
///
/// # 参数
/// - `path`: 文件或文件夹的完整路径
///
/// # 逻辑
/// 1. 从路径提取文件名
/// 2. 自动检测类型（folder/image/exe/bat/ps1）
/// 3. INSERT OR IGNORE 防止重复添加（path 有唯一约束）
/// 4. 返回新插入的 Item
#[tauri::command]
pub fn add_item(db: State<Database>, path: String) -> Result<Item, String> {
    let conn = db.get_conn();
    let name = get_name(&path);
    let item_type = detect_type(&path);

    conn.execute(
        "INSERT OR IGNORE INTO items (name, path, type) VALUES (?1, ?2, ?3)",
        params![name, &path, item_type],
    )
    .map_err(|e| e.to_string())?;

    // 不论本次是否插入成功，都按 path 回查，避免 INSERT OR IGNORE 场景返回错误记录。
    let sql = format!("SELECT {} FROM items WHERE path = ?1", ITEM_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row([path], item_from_row)
        .map_err(|e| e.to_string())
}

/// 删除项目
/// 由于 item_tags 表设置了 ON DELETE CASCADE，关联的标签记录会自动删除
#[tauri::command]
pub fn remove_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute("DELETE FROM items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新项目缩略图路径
/// - 传入 Some(path): 设置/更换缩略图
/// - 传入 None: 清除缩略图，回退到类型图标
#[tauri::command]
pub fn update_item_icon(
    db: State<Database>,
    item_id: i64,
    icon_path: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let normalized = icon_path.and_then(|p| {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let affected = conn
        .execute(
            "UPDATE items SET icon_path = ?1 WHERE id = ?2",
            params![normalized, item_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err(format!("Item {} not found", item_id));
    }
    Ok(())
}

/// 获取所有项目（含标签信息）
/// 按 ITEM_ORDER 排序：收藏优先 → 最近使用 → 名称
#[tauri::command]
pub fn get_items(app: AppHandle, db: State<Database>) -> Result<Vec<ItemWithTags>, String> {
    let mut items: Vec<Item> = {
        let conn = db.get_conn();
        let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], item_from_row)
            .map_err(|e| e.to_string())?;
        let collected: Vec<Item> = rows.filter_map(|r| r.ok()).collect();
        collected
    };
    fill_auto_visual_paths(&app, &mut items);

    let conn = db.get_conn();
    items_with_tags(&conn, items)
}

/// 切换收藏状态
/// 使用 CASE WHEN 在数据库层面翻转 0/1，避免竞态条件
/// 返回新的收藏状态
#[tauri::command]
pub fn toggle_favorite(db: State<Database>, id: i64) -> Result<bool, String> {
    let conn = db.get_conn();
    conn.execute(
        "UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    let new_val: i64 = conn
        .query_row("SELECT is_favorite FROM items WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(new_val != 0)
}

// ============================================================================
// 标签管理命令
// ============================================================================

/// 获取所有标签，按名称排序
#[tauri::command]
pub fn get_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    let conn = db.get_conn();
    let mut stmt = conn
        .prepare("SELECT id, name, color FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// 新建标签，返回创建的 Tag（含自增 ID）
#[tauri::command]
pub fn add_tag(db: State<Database>, name: String, color: String) -> Result<Tag, String> {
    let conn = db.get_conn();
    conn.execute(
        "INSERT INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Tag { id, name, color })
}

/// 更新标签的名称和颜色
#[tauri::command]
pub fn update_tag(db: State<Database>, id: i64, name: String, color: String) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除标签（item_tags 中的关联记录会级联删除）
#[tauri::command]
pub fn remove_tag(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 设置项目的标签列表（全量替换）
///
/// # 逻辑
/// 1. 先删除该项目的所有标签关联
/// 2. 再逐个插入新的关联
///
/// 这种"先删后插"的策略简单可靠，适合标签数量不多的场景
#[tauri::command]
pub fn set_item_tags(db: State<Database>, item_id: i64, tag_ids: Vec<i64>) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [item_id])
        .map_err(|e| e.to_string())?;

    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================================
// 搜索命令
// ============================================================================

/// 后端搜索（支持文本 + 标签组合查询）
///
/// 注意：当前前端实际使用的是客户端 Fuse.js 搜索（支持拼音和同义词），
/// 此命令作为备用方案保留。
///
/// 根据 query 和 tag_ids 的组合，分 4 种情况调用不同的查询函数
#[tauri::command]
pub fn search_items(
    app: AppHandle,
    db: State<Database>,
    query: String,
    tag_ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    let mut items: Vec<Item> = {
        let conn = db.get_conn();
        if query.is_empty() && tag_ids.is_empty() {
            query_all_items(&conn)?
        } else if !query.is_empty() && tag_ids.is_empty() {
            query_items_by_text(&conn, &query)?
        } else if query.is_empty() && !tag_ids.is_empty() {
            query_items_by_tags(&conn, &tag_ids)?
        } else {
            query_items_by_text_and_tags(&conn, &query, &tag_ids)?
        }
    };
    fill_auto_visual_paths(&app, &mut items);

    let conn = db.get_conn();
    items_with_tags(&conn, items)
}

/// 查询所有项目（无筛选条件）
fn query_all_items(conn: &rusqlite::Connection) -> Result<Vec<Item>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// 按文本模糊查询（LIKE %query%）
/// 搜索 name 和 path 两个字段
fn query_items_by_text(conn: &rusqlite::Connection, query: &str) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let sql = format!(
        "SELECT {} FROM items WHERE name LIKE ?1 OR path LIKE ?1 ORDER BY {}",
        ITEM_COLS, ITEM_ORDER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([search_query], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// 按标签筛选（OR 逻辑：包含任一选中标签的项目）
/// 使用 DISTINCT 去重（一个项目可能匹配多个标签）
fn query_items_by_tags(conn: &rusqlite::Connection, tag_ids: &[i64]) -> Result<Vec<Item>, String> {
    // 动态生成 IN (?, ?, ...) 占位符
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE it.tag_id IN ({})
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    // 将 tag_ids 转换为 &dyn ToSql 切片，适配 rusqlite 的参数绑定
    let params: Vec<&dyn rusqlite::ToSql> = tag_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// 按文本 + 标签组合查询
/// 文本条件用 ?1，标签条件用 ?2, ?3, ... 动态占位符
fn query_items_by_text_and_tags(
    conn: &rusqlite::Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE (i.name LIKE ?1 OR i.path LIKE ?1)
         AND it.tag_id IN ({})
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // 构建混合参数列表：第一个是搜索文本，后面是标签 ID
    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in tag_ids {
        params_values.push(Box::new(*id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

// ============================================================================
// 启动/打开命令
// ============================================================================

/// 启动项目（双击或回车触发）
///
/// # 逻辑
/// 1. 从数据库查询项目路径
/// 2. 更新 last_used_at 为当前时间（影响排序）
/// 3. 使用 `cmd /C start "" "path"` 启动
///    - start 后的空字符串 "" 是窗口标题参数（必须有，否则路径含空格会出错）
///    - spawn() 异步启动，不阻塞应用
#[tauri::command]
pub fn launch_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();

    let path: String = conn
        .query_row("SELECT path FROM items WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE items SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 在资源管理器中打开项目所在目录
/// 如果路径是文件，则打开其父目录；如果是文件夹，直接打开
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = Path::new(&path);
        let dir = if p.is_dir() {
            &path
        } else {
            p.parent()
                .map(|p| p.to_str().unwrap_or(&path))
                .unwrap_or(&path)
        };
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================================
// 同义词命令
// ============================================================================

/// 从 exe 同级目录读取同义词字典
///
/// # 逻辑
/// 1. 获取当前 exe 所在目录
/// 2. 检查 synonyms.json 是否存在
/// 3. 不存在 → 将编译时内嵌的默认数据写入文件
/// 4. 读取文件内容并解析为 Vec<Vec<String>>
///
/// # 设计意图
/// 用户可以直接编辑 exe 同级的 synonyms.json 文件来自定义同义词，
/// 重启应用后生效。include_str! 在编译时将默认数据嵌入二进制文件，
/// 确保首次运行时有默认数据可用。
#[tauri::command]
fn resolve_synonyms_path(app: &AppHandle, default_content: &str) -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .join("synonyms.json");

    if exe_path.exists() {
        return Ok(exe_path);
    }
    if std::fs::write(&exe_path, default_content).is_ok() {
        return Ok(exe_path);
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    let fallback_path = app_data_dir.join("synonyms.json");
    if !fallback_path.exists() {
        std::fs::write(&fallback_path, default_content).map_err(|e| e.to_string())?;
    }
    Ok(fallback_path)
}

#[tauri::command]
pub fn read_synonyms(app: AppHandle) -> Result<Vec<Vec<String>>, String> {
    // 内置默认词库（编译时嵌入）
    let default = include_str!("../../src/data/synonyms.json");
    let path = resolve_synonyms_path(&app, default)?;

    let builtin_groups: Vec<Vec<String>> =
        serde_json::from_str(default).map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file_groups: Vec<Vec<String>> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 合并默认词库与用户词库，按标准化后的词集合去重，避免重复组干扰搜索权重。
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for group in builtin_groups.into_iter().chain(file_groups.into_iter()) {
        let cleaned: Vec<String> = group
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if cleaned.is_empty() {
            continue;
        }

        let mut key_words: Vec<String> = cleaned.iter().map(|s| s.to_lowercase()).collect();
        key_words.sort();
        key_words.dedup();
        let key = key_words.join("\u{1f}");
        if seen.insert(key) {
            merged.push(cleaned);
        }
    }
    Ok(merged)
}

// ============================================================================
// 文件柜命令
// ============================================================================

/// 获取所有文件柜，按名称排序
#[tauri::command]
pub fn get_cabinets(db: State<Database>) -> Result<Vec<Cabinet>, String> {
    let conn = db.get_conn();
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM cabinets ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cabinets = stmt
        .query_map([], |row| {
            Ok(Cabinet {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(cabinets)
}

/// 新建文件柜
#[tauri::command]
pub fn add_cabinet(db: State<Database>, name: String, color: String) -> Result<Cabinet, String> {
    let conn = db.get_conn();
    conn.execute(
        "INSERT INTO cabinets (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    // 查询数据库生成的 created_at 值
    let created_at: String = conn
        .query_row("SELECT created_at FROM cabinets WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(Cabinet {
        id,
        name,
        color,
        created_at,
    })
}

/// 更新文件柜名称和颜色
#[tauri::command]
pub fn update_cabinet(
    db: State<Database>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute(
        "UPDATE cabinets SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除文件柜（cabinet_items 中的关联记录会级联删除）
#[tauri::command]
pub fn remove_cabinet(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute("DELETE FROM cabinets WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 添加项目到文件柜
/// INSERT OR IGNORE 防止重复添加（复合主键约束）
#[tauri::command]
pub fn add_item_to_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute(
        "INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id) VALUES (?1, ?2)",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从文件柜移除项目
#[tauri::command]
pub fn remove_item_from_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute(
        "DELETE FROM cabinet_items WHERE cabinet_id = ?1 AND item_id = ?2",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取文件柜内的所有项目（含标签信息）
#[tauri::command]
pub fn get_cabinet_items(
    app: AppHandle,
    db: State<Database>,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    let mut items: Vec<Item> = {
        let conn = db.get_conn();
        let mut stmt = conn
            .prepare(
                "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN cabinet_items ci ON i.id = ci.item_id
         WHERE ci.cabinet_id = ?1
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([cabinet_id], item_from_row)
            .map_err(|e| e.to_string())?;
        let collected: Vec<Item> = rows.filter_map(|r| r.ok()).collect();
        collected
    };
    fill_auto_visual_paths(&app, &mut items);

    let conn = db.get_conn();
    items_with_tags(&conn, items)
}
