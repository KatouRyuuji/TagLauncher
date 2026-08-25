use crate::models::{Item, ItemWithTags};
use crate::services::file_identity::{self, FileIdentity};
use crate::services::icon_service;
use crate::services::tag_service;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

/// SELECT 查询中使用的列名常量
pub const ITEM_COLS: &str =
    "id, name, path, type, icon_path, created_at, last_used_at, is_favorite, is_missing";

/// 默认排序：收藏优先 → 最近使用 → 名称
pub const ITEM_ORDER: &str = "is_favorite DESC, last_used_at DESC NULLS LAST, name";

/// 从数据库行映射为 Item
pub fn item_from_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    let fav: i64 = row.get(7)?;
    let missing: i64 = row.get(8)?;
    Ok(Item {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        item_type: row.get(3)?,
        icon_path: row.get(4)?,
        created_at: row.get(5)?,
        last_used_at: row.get(6)?,
        is_favorite: fav != 0,
        is_missing: missing != 0,
    })
}

/// 列表查询的行映射失败处理：不静默吞掉（对象会从列表悄悄消失且无从排查），
/// 记日志后跳过该行。供各列表/快照读取的 `.filter_map(...)` 统一使用。
pub(crate) fn skip_err_with_log<T>(ctx: &str) -> impl Fn(rusqlite::Result<T>) -> Option<T> + '_ {
    move |r| match r {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("[{}] 行读取失败，已跳过: {}", ctx, e);
            None
        }
    }
}

/// 解析行中的文件身份（volume_serial + file_id 十六进制）。
fn row_identity(volume_serial: Option<i64>, file_id_hex: Option<String>) -> Option<FileIdentity> {
    let vs = volume_serial?;
    let fid = FileIdentity::parse_file_id_hex(&file_id_hex?)?;
    Some(FileIdentity {
        volume_serial: vs as u32,
        file_id: fid,
    })
}

/// 按 id 取回单个 Item。
fn select_item_by_id(conn: &Connection, id: i64) -> Result<Item, String> {
    let sql = format!("SELECT {} FROM items WHERE id = ?1", ITEM_COLS);
    conn.prepare(&sql)
        .map_err(|e| e.to_string())?
        .query_row([id], item_from_row)
        .map_err(|e| e.to_string())
}

/// 图片扩展名（单一来源，供 detect_type 与 object_preview_service 共用）。
pub const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif",
];

/// 音频扩展名（单一来源，供 detect_type 与 object_preview_service 共用）。
pub const AUDIO_EXTS: &[&str] = &[
    "aac", "ape", "aiff", "aif", "afc", "aifc", "mp3", "mp2", "mp1", "wav", "wave", "wv", "opus",
    "flac", "ogg", "m4a", "m4b", "m4p", "m4r", "mpc", "mp+", "mpp", "spx",
];

/// 按（已小写的）扩展名归类为对象类型。不含目录判断——目录由调用方先行处理。
///
/// 未知扩展名归为 `"exe"`：启动统一走 ShellExecuteW("open")、**不依据 type 分支**，
/// 故这里 `"exe"` 的语义是「当作可用关联程序 shell 打开的通用文件」，而非"必为可执行程序"。
/// 该归类仅影响前端图标/分类展示，不影响启动正确性，因此 items.type 的 CHECK 约束保持不变
/// （前端对非可执行扩展的图标区分由前端处理）。
pub fn classify_by_extension(ext: Option<&str>) -> &'static str {
    match ext {
        Some(e) if IMAGE_EXTS.contains(&e) => "image",
        Some(e) if AUDIO_EXTS.contains(&e) => "audio",
        Some("exe") => "exe",
        Some("bat") | Some("cmd") => "bat",
        Some("ps1") => "ps1",
        _ => "exe",
    }
}

/// 自动检测文件类型
pub fn detect_type(path: &str) -> &'static str {
    let p = Path::new(path);
    if p.is_dir() {
        return "folder";
    }
    classify_by_extension(
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
    )
}

/// 从路径提取文件名
pub fn get_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// 添加项目：以文件身份(卷序列号+文件ID)为唯一键去重；取不到身份时回退按 path 去重。
fn add_one(conn: &Connection, path: &str) -> Result<Item, String> {
    let identity = file_identity::get_identity(path);
    // 内容签名（仅文件有效）：用于跨盘兜底重定位，也用于身份命中时的二次校验。
    let sig = file_identity::compute_signature(path);
    // 有效身份：默认取捕获到的身份；若与既有同身份记录发生签名冲突（克隆盘卷序列号重复），
    // 降级为无身份处理，避免改写既有记录、也避开身份唯一索引冲突。
    let mut effective_identity = identity;

    if let Some(idn) = identity {
        // 连同既有记录的路径与内容签名一起取出：签名用于二次校验，路径用于区分冲突情形。
        let existing: Option<(i64, String, Option<i64>, Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT id, path, sig_size, sig_head, sig_tail FROM items \
                 WHERE volume_serial = ?1 AND file_id = ?2",
                params![idn.volume_serial as i64, idn.file_id_hex()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((existing_id, existing_path, esize, ehead, etail)) = existing {
            // 二次校验：卷序列号在克隆/镜像盘上可能重复，使不同物理文件共享 (vol,fid)。
            // 若新文件与既有记录都带内容签名且不一致，判为身份冲突。
            // 任一方缺签名时无法反证，沿用身份判定（保持既有行为）。
            let conflict = match (sig, esize, ehead, etail) {
                (Some(ns), Some(es), Some(eh), Some(et)) => {
                    ns.size as i64 != es || ns.head_hash as i64 != eh || ns.tail_hash as i64 != et
                }
                _ => false,
            };
            if conflict {
                // 区分「克隆盘异文件」与「同文件被编辑后移动/改名」（file_id 不变、签名变化）：
                // - 既有记录的 path 仍存在 → 那里确有另一个文件（克隆盘撞车）→ 降级无身份插入；
                // - 既有记录的 path 已不存在 → 大概率同一文件被移动且编辑 → 更新既有记录到
                //   最新位置并刷新签名，否则会产生"旧记录+新记录"双份且下一轮对账撞唯一索引。
                if Path::new(&existing_path).exists() {
                    effective_identity = None;
                } else {
                    // 路径/名称刷新时同步用 detect_type 重算 type：改名/移动可能改变扩展名，
                    // type 须与当前路径一致（INSERT 路径的 detect_type 口径不变）。
                    if let Some(ns) = sig {
                        conn.execute(
                            "UPDATE items SET path = ?1, name = ?2, type = ?3, is_missing = 0, \
                             sig_size = ?4, sig_head = ?5, sig_tail = ?6 WHERE id = ?7",
                            params![
                                path,
                                get_name(path),
                                detect_type(path),
                                ns.size as i64,
                                ns.head_hash as i64,
                                ns.tail_hash as i64,
                                existing_id
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                    } else {
                        conn.execute(
                            "UPDATE items SET path = ?1, name = ?2, type = ?3, is_missing = 0 WHERE id = ?4",
                            params![path, get_name(path), detect_type(path), existing_id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    return select_item_by_id(conn, existing_id);
                }
            } else {
                // 已管理同一文件（即使被改名/移动过）→ 更新到最新位置、清除失效标记后返回。
                conn.execute(
                    "UPDATE items SET path = ?1, name = ?2, type = ?3, is_missing = 0 WHERE id = ?4",
                    params![path, get_name(path), detect_type(path), existing_id],
                )
                .map_err(|e| e.to_string())?;
                return select_item_by_id(conn, existing_id);
            }
        }
    }

    // 身份查询未命中（含本次未取到身份、身份冲突降级）→ 按 path 去重。
    // 不能只限 effective_identity.is_none() 才走这里：既有记录身份列为 NULL、本次却
    // 取到身份时身份查询必然 miss，若跳过 path 去重会重复 INSERT 同路径行
    // （v005 起 path 无唯一约束，数据库层面不再兜底）。
    let existing_by_path: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT id, file_id FROM items WHERE path = ?1",
            [path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((existing_id, efid)) = existing_by_path {
        // 既有记录带身份且本次也取到身份：身份查询刚 miss ⇒ 二者必不同——path 处文件
        // 已被替换成另一个文件。此时不合并：落到下方为新文件 INSERT 新行，旧行留待对账
        // 按身份重定位，避免新文件错挂到旧身份上（启动时会重定位到已移走的原文件）。
        if !(efid.is_some() && effective_identity.is_some()) {
            if efid.is_none() {
                if let Some(idn) = effective_identity {
                    // 既有记录无身份而本次取到身份 → 顺手回填身份与内容签名。
                    // 身份查询刚 miss，回填必不撞身份唯一索引。
                    // 同路径下文件可能被替换过（如目录换成同名 exe），一并刷新 type。
                    conn.execute(
                        "UPDATE items SET name = ?1, type = ?2, is_missing = 0, \
                         volume_serial = ?3, file_id = ?4, sig_size = ?5, sig_head = ?6, sig_tail = ?7 \
                         WHERE id = ?8",
                        params![
                            get_name(path),
                            detect_type(path),
                            idn.volume_serial as i64,
                            idn.file_id_hex(),
                            sig.map(|s| s.size as i64),
                            sig.map(|s| s.head_hash as i64),
                            sig.map(|s| s.tail_hash as i64),
                            existing_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    return select_item_by_id(conn, existing_id);
                }
            }
            // 其余合并情形（本次无身份或身份冲突降级）：刷新名称并清除失效标记，
            // 不触碰其已有身份列。type 同步刷新（同路径文件可能已被替换）。
            conn.execute(
                "UPDATE items SET name = ?1, type = ?2, is_missing = 0 WHERE id = ?3",
                params![get_name(path), detect_type(path), existing_id],
            )
            .map_err(|e| e.to_string())?;
            return select_item_by_id(conn, existing_id);
        }
    }

    let name = get_name(path);
    let item_type = detect_type(path);
    let (vol, fid) = match effective_identity {
        Some(i) => (Some(i.volume_serial as i64), Some(i.file_id_hex())),
        None => (None, None),
    };
    conn.execute(
        "INSERT INTO items (name, path, type, volume_serial, file_id, sig_size, sig_head, sig_tail) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            name,
            path,
            item_type,
            vol,
            fid,
            sig.map(|s| s.size as i64),
            sig.map(|s| s.head_hash as i64),
            sig.map(|s| s.tail_hash as i64)
        ],
    )
    .map_err(|e| e.to_string())?;

    select_item_by_id(conn, conn.last_insert_rowid())
}

/// 添加项目
pub fn add_item(conn: &Connection, path: &str) -> Result<Item, String> {
    // 与 add_items 的单项校验同一口径：空路径不落库（单条命令入口此前无此防御，
    // 空串会落成 name="" 的 exe 记录）
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    add_one(conn, path)
}

fn add_item_in_tx(tx: &rusqlite::Transaction<'_>, path: &str) -> Result<Item, String> {
    add_one(tx, path)
}

#[derive(Serialize)]
pub struct AddItemsResult {
    pub items: Vec<Item>,
    pub failed: Vec<AddItemFailure>,
}

#[derive(Serialize)]
pub struct AddItemFailure {
    pub path: String,
    pub error: String,
}

/// 批量添加项目（逐条隔离失败，避免单条异常影响整批导入）
pub fn add_items(conn: &mut Connection, paths: Vec<String>) -> AddItemsResult {
    let mut items = Vec::new();
    let mut failed = Vec::new();

    let tx = match conn.transaction() {
        Ok(tx) => tx,
        Err(error) => {
            return AddItemsResult {
                items,
                failed: paths
                    .into_iter()
                    .map(|path| AddItemFailure {
                        path,
                        error: error.to_string(),
                    })
                    .collect(),
            };
        }
    };

    for path in paths {
        if path.trim().is_empty() {
            failed.push(AddItemFailure {
                path,
                error: "路径不能为空".to_string(),
            });
            continue;
        }

        match add_item_in_tx(&tx, &path) {
            Ok(item) => items.push(item),
            Err(error) => failed.push(AddItemFailure { path, error }),
        }
    }

    if let Err(error) = tx.commit() {
        // 整批回滚场景：之前逐项校验失败的（本就非法）保留原始错误，
        // 而原本成功却被回滚的项加上"批量回滚: "前缀，便于前端区分两类失败。
        return AddItemsResult {
            items: Vec::new(),
            failed: failed
                .into_iter()
                .chain(items.into_iter().map(|item| AddItemFailure {
                    path: item.path,
                    error: format!("批量回滚: {}", error),
                }))
                .collect(),
        };
    }

    AddItemsResult { items, failed }
}

/// SQL `IN (...)` 占位符分块大小（对齐 tag_service::get_tags_for_items，
/// 避免超过 SQLite 变量数上限；大批量选择/删除时按块执行）。
const IN_CHUNK: usize = 500;

/// 批量删除项目：按 IN_CHUNK 分块，多块包在单事务里保持整体原子。
pub fn remove_items(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for chunk in ids.chunks(IN_CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM items WHERE id IN ({})", placeholders);
        let params = chunk
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        tx.execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除项目
pub fn remove_item(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新项目缩略图
pub fn update_item_icon(
    conn: &Connection,
    item_id: i64,
    icon_path: Option<String>,
) -> Result<(), String> {
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

/// 获取所有项目（含标签，不含自动图标）。
/// 自动图标涉及文件系统/PowerShell IO，由调用方在释放 DB 锁后用 fill_visuals 补齐，
/// 避免在持有 DB 锁期间串行执行重 IO 阻塞其它命令。
pub fn get_items(conn: &Connection) -> Result<Vec<ItemWithTags>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let items: Vec<Item> = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(skip_err_with_log("get_items"))
        .collect();

    tag_service::items_with_tags(conn, items)
}

/// 在锁外为列表补齐自动可视路径（图标/封面）。
pub fn fill_visuals(app: &AppHandle, items: &mut [ItemWithTags]) {
    for iwt in items.iter_mut() {
        icon_service::fill_item_visual(app, &mut iwt.item);
    }
}

/// 获取单个项目（含标签，不含自动图标）。
/// 自动图标涉及文件系统/PowerShell IO，由调用方在释放 DB 锁后用 fill_visuals 补齐，
/// 避免在持有 DB 锁期间串行执行重 IO 阻塞其它命令（与 get_items 一致）。
pub fn get_item(conn: &Connection, id: i64) -> Result<ItemWithTags, String> {
    let sql = format!("SELECT {} FROM items WHERE id = ?1", ITEM_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let item = stmt.query_row([id], item_from_row).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => format!("Item {} not found", id),
        other => other.to_string(),
    })?;

    // items_with_tags 输出与输入等长：单个输入必产出单个输出
    Ok(tag_service::items_with_tags(conn, vec![item])?
        .into_iter()
        .next()
        .expect("items_with_tags 输出与输入等长"))
}

/// 按默认排序（ITEM_ORDER：收藏优先 → 最近使用 DESC(NULLS LAST) → 名称）在内存中排序。
/// 分块查询后各块内部有序但整体无序，需在此统一重排以保持与单条 SQL ORDER BY 一致的顺序。
/// last_used_at 为 SQLite DATETIME 文本（ISO 格式），字节序比较与 SQLite 默认 BINARY 排序一致。
fn sort_items_by_default_order(items: &mut [Item]) {
    items.sort_by(|a, b| {
        // is_favorite DESC（true 在前）
        b.is_favorite
            .cmp(&a.is_favorite)
            // last_used_at DESC NULLS LAST
            .then_with(|| match (&a.last_used_at, &b.last_used_at) {
                (Some(x), Some(y)) => y.cmp(x),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
            // name ASC
            .then_with(|| a.name.cmp(&b.name))
    });
}

/// 批量获取指定项目（含标签，不含自动图标）。图标由调用方在锁外用 fill_visuals 补齐。
/// id 列表按 IN_CHUNK 分块查询后在内存里按默认顺序重排。
pub fn get_items_by_ids(conn: &Connection, ids: &[i64]) -> Result<Vec<ItemWithTags>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut unique_ids = ids.to_vec();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    let mut items: Vec<Item> = Vec::with_capacity(unique_ids.len());
    for chunk in unique_ids.chunks(IN_CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT {} FROM items WHERE id IN ({})", ITEM_COLS, placeholders);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params = chunk
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let chunk_items = stmt
            .query_map(params.as_slice(), item_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(skip_err_with_log("get_items_by_ids"));
        items.extend(chunk_items);
    }
    sort_items_by_default_order(&mut items);

    tag_service::items_with_tags(conn, items)
}

/// 切换收藏状态
pub fn toggle_favorite(conn: &Connection, id: i64) -> Result<bool, String> {
    // UPDATE ... RETURNING 一次完成翻转并取回新值（省去二次 SELECT 往返）。
    // id 不存在时 RETURNING 无行返回：映射为友好文案，不把裸 rusqlite 错误抛给前端。
    let new_val: i64 = conn
        .query_row(
            "UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END \
             WHERE id = ?1 RETURNING is_favorite",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("对象不存在（id {}），可能已被删除", id),
            other => other.to_string(),
        })?;

    Ok(new_val != 0)
}

/// 惰性对账：刷新时检测每个对象的文件是否仍在原路径，
/// - 在原路径 → 视为有效；缺身份则回填文件ID；曾失效则清除失效标记。
/// - 不在原路径但有文件ID → 用文件ID重定位（同盘移动/重命名），成功则更新 path/name，失败标记失效。
/// - 不在原路径且无文件ID → 标记失效。
/// 仅断裂的对象才走 FFI 重定位，常规刷新只做一次廉价的 exists() 检查。
///
/// 对账拆为三段以便把重 IO 移出全局 DB 锁（避免持锁期间逐对象串行执行文件系统/FFI IO
/// 阻塞其它命令）：① `read_reconcile_snapshot` 锁内取快照 → ② `plan_reconcile` 锁外做
/// exists()/FFI/签名等重 IO 生成写入计划 → ③ `apply_reconcile` 锁内批量回写。
/// 本函数按顺序串起三段，供测试与不需要锁外化的调用方使用；两个列表刷新热路径
/// （get_items / get_cabinet_items）均由命令层分段调用以在重 IO 期间释放锁。
/// 三段合并与内联版本对数据库的最终效果完全一致。
// 保留为便捷入口（当前仅对账回归测试直接调用；命令层已全部走分段），标 allow 避免 dead_code 告警。
#[allow(dead_code)]
pub fn reconcile_items(conn: &Connection) -> Result<(), String> {
    let rows = read_reconcile_snapshot(conn)?;
    let writes = plan_reconcile(rows);
    apply_reconcile(conn, &writes)
}

/// 对账快照行（锁内一次性读出，随后据此在锁外做重 IO）。
pub struct ReconcileRow {
    id: i64,
    path: String,
    volume_serial: Option<i64>,
    file_id: Option<String>,
    is_missing: i64,
    sig_size: Option<i64>,
}

/// 对账写入项：锁外 IO 阶段生成的写入计划，锁内批量原子回写。
pub enum ReconcileWrite {
    /// 回填文件身份（卷序列号 + 文件ID）。
    BackfillIdentity { id: i64, volume_serial: i64, file_id: String },
    /// 惰性回填内容签名（大小 + 首/尾哈希）。
    BackfillSignature { id: i64, size: i64, head: i64, tail: i64 },
    /// 文件在原路径且曾失效 → 清除失效标记。
    ClearMissing { id: i64 },
    /// 按文件ID重定位到新路径并清除失效标记（new_type 在锁外 IO 阶段用 detect_type 预计算）。
    Relocate { id: i64, new_path: String, new_name: String, new_type: &'static str },
    /// 文件找不到 → 标记失效。
    MarkMissing { id: i64 },
}

/// 【对账·第一段】锁内一次性读出对账所需快照（不做任何文件 IO）。
pub fn read_reconcile_snapshot(conn: &Connection) -> Result<Vec<ReconcileRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, path, volume_serial, file_id, is_missing, sig_size FROM items")
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([], |r| {
            Ok(ReconcileRow {
                id: r.get(0)?,
                path: r.get(1)?,
                volume_serial: r.get(2)?,
                file_id: r.get(3)?,
                is_missing: r.get(4)?,
                sig_size: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(mapped
        .filter_map(skip_err_with_log("read_reconcile_snapshot"))
        .collect())
}

/// 【对账·第二段】不持 DB 锁：对每个对象做 exists()/get_identity(FFI)/compute_signature(读文件)/
/// resolve_path(FFI 枚举盘符) 等重 IO，产出写入计划。纯文件系统访问，不触碰数据库，
/// 故可在释放全局 DB 锁后执行——这是把重 IO 移出锁的关键一段。
pub fn plan_reconcile(rows: Vec<ReconcileRow>) -> Vec<ReconcileWrite> {
    let mut writes = Vec::new();
    for row in rows {
        let exists = Path::new(&row.path).exists();
        let identity = row_identity(row.volume_serial, row.file_id);

        if exists {
            // 口径说明（有意取舍）：路径仍在时不校验"该处文件是否已被替换成另一个文件"
            // （不比对文件身份），与 resolve_current_path 的身份校验口径不同。对账是每次
            // 列表刷新都跑的轻量路径，逐对象 FFI 身份比对太贵；被替换的误挂在启动/打开时
            // 由 resolve_current_path 自愈，此处容忍短暂偏差。
            if identity.is_none() {
                // 回填文件ID。唯一冲突=极少数多条记录指向同一物理文件(硬链接/历史重复)，
                // 由回写阶段记录日志以便排查，不阻断对账（该记录退化为按 path 处理）。
                if let Some(newid) = file_identity::get_identity(&row.path) {
                    writes.push(ReconcileWrite::BackfillIdentity {
                        id: row.id,
                        volume_serial: newid.volume_serial as i64,
                        file_id: newid.file_id_hex(),
                    });
                }
            }
            // 惰性回填内容签名（仅文件、一次性）：为跨盘兜底重定位准备弱身份。
            if row.sig_size.is_none() {
                if let Some(sig) = file_identity::compute_signature(&row.path) {
                    writes.push(ReconcileWrite::BackfillSignature {
                        id: row.id,
                        size: sig.size as i64,
                        head: sig.head_hash as i64,
                        tail: sig.tail_hash as i64,
                    });
                }
            }
            if row.is_missing != 0 {
                writes.push(ReconcileWrite::ClearMissing { id: row.id });
            }
        } else if let Some(idn) = identity {
            match file_identity::resolve_path(idn, &row.path) {
                Some(new_path) => {
                    let new_name = get_name(&new_path);
                    // 重定位后扩展名可能已变，锁外预计算 type（detect_type 含 FS IO，不进锁内回写段）
                    let new_type = detect_type(&new_path);
                    writes.push(ReconcileWrite::Relocate {
                        id: row.id,
                        new_path,
                        new_name,
                        new_type,
                    });
                }
                None if row.is_missing == 0 => {
                    writes.push(ReconcileWrite::MarkMissing { id: row.id });
                }
                None => {}
            }
        } else if row.is_missing == 0 {
            writes.push(ReconcileWrite::MarkMissing { id: row.id });
        }
    }
    writes
}

/// 【对账·第三段】锁内批量回写：把写入计划包在单个事务里原子应用。
/// 各条写入的容错策略与原内联实现一致：身份回填失败记日志、其余静默忽略。
pub fn apply_reconcile(conn: &Connection, writes: &[ReconcileWrite]) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for w in writes {
        match w {
            ReconcileWrite::BackfillIdentity { id, volume_serial, file_id } => {
                if let Err(e) = tx.execute(
                    "UPDATE items SET volume_serial = ?1, file_id = ?2 WHERE id = ?3",
                    params![volume_serial, file_id, id],
                ) {
                    eprintln!("[reconcile] 回填 file_id 失败 (item {}): {}", id, e);
                }
            }
            ReconcileWrite::BackfillSignature { id, size, head, tail } => {
                let _ = tx.execute(
                    "UPDATE items SET sig_size = ?1, sig_head = ?2, sig_tail = ?3 WHERE id = ?4",
                    params![size, head, tail, id],
                );
            }
            ReconcileWrite::ClearMissing { id } => {
                let _ = tx.execute("UPDATE items SET is_missing = 0 WHERE id = ?1", [id]);
            }
            ReconcileWrite::Relocate { id, new_path, new_name, new_type } => {
                let _ = tx.execute(
                    "UPDATE items SET path = ?1, name = ?2, type = ?3, is_missing = 0 WHERE id = ?4",
                    params![new_path, new_name, new_type, id],
                );
            }
            ReconcileWrite::MarkMissing { id } => {
                let _ = tx.execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]);
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 取对象当前真实路径（用于启动 / 打开所在文件夹）：
/// 路径有效直接返回；失效则用文件ID重定位并持久化新路径；彻底找不到则标记失效并返回错误。
pub fn resolve_current_path(conn: &Connection, id: i64) -> Result<String, String> {
    let (path, vol, fid): (String, Option<i64>, Option<String>) = conn
        .query_row(
            "SELECT path, volume_serial, file_id FROM items WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("对象不存在（id {}），可能已被删除", id)
            }
            other => other.to_string(),
        })?;

    let identity = row_identity(vol, fid);

    // 路径仍存在时：无身份记录直接采信；有身份记录则校验该路径处文件确为同一对象，
    // 防止原文件被删后同位置放入了不同文件，从而启动/打开到错误对象。
    if Path::new(&path).exists() {
        match identity {
            Some(idn) if file_identity::get_identity(&path) != Some(idn) => {
                // 路径已被其它文件占用 → 落到下方按文件ID重定位真正的对象
            }
            _ => return Ok(path),
        }
    }

    if let Some(idn) = identity {
        if let Some(new_path) = file_identity::resolve_path(idn, &path) {
            conn.execute(
                "UPDATE items SET path = ?1, name = ?2, is_missing = 0 WHERE id = ?3",
                params![new_path, get_name(&new_path), id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(new_path);
        }
    }

    let _ = conn.execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]);
    Err("对象已丢失，无法定位文件".to_string())
}

// ─────────────────────────────────────────────────────────────────────────
// 跨盘符兜底找回：对失效对象按内容签名在候选盘扫描重定位。
// 扫描在 DB 锁外进行（命令层先取数据释放锁，扫描，再加锁回写），避免长扫描阻塞其它命令。
// ─────────────────────────────────────────────────────────────────────────

/// 待按签名找回的失效对象（已带内容签名）。
pub struct MissingSignatureRow {
    pub id: i64,
    pub size: u64,
    pub head: u64,
    pub tail: u64,
}

/// 读取所有"失效且有内容签名"的对象，供锁外扫描使用。
pub fn read_missing_signatures(conn: &Connection) -> Result<Vec<MissingSignatureRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sig_size, sig_head, sig_tail FROM items \
             WHERE is_missing = 1 AND sig_size IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MissingSignatureRow {
                id: r.get(0)?,
                size: r.get::<_, i64>(1)? as u64,
                head: r.get::<_, i64>(2)? as u64,
                tail: r.get::<_, i64>(3)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(skip_err_with_log("read_missing_signatures"))
        .collect())
}

/// 扫描时跳过的系统目录名与遍历上限（异常情况下防止无限扫描）。
const SCAN_SKIP_DIRS: &[&str] = &[
    "$Recycle.Bin",
    "System Volume Information",
    "$WinREAgent",
    "$SysReset",
    "Windows.old",
];
const SCAN_MAX_ENTRIES: usize = 3_000_000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// 每个失效对象最多保留的候选匹配数：达到 2 即可判定"歧义"，无需再找第 3 个。
const MAX_SIGNATURE_CANDIDATES: usize = 2;

/// 在候选盘内遍历，按 (size → 签名) 匹配失效对象，仅返回**唯一命中**的 (item_id, 新路径)。
/// 不持有 DB 锁。先按文件大小廉价预筛，命中大小再做哈希校验。
///
/// 内容签名是弱身份（size + 首/尾 16KB 哈希），可能有多个不同文件恰好同签名。为避免把对象
/// 误重定位到错误文件，此处**收集每个对象的全部候选**（最多留 2 个），扫描结束后只回写
/// 恰好唯一命中的对象；0 个（未找到）或 ≥2 个（歧义）不自动回写，留给用户处理。
/// 代价是无法在首个命中即提前结束（需扫到预算/遍历完以确认唯一性），但该操作仅在用户显式
/// 触发"跨盘找回"时运行、且在锁外执行，可接受。
pub fn scan_for_signatures(rows: &[MissingSignatureRow]) -> Vec<(i64, String)> {
    use std::collections::HashMap;
    if rows.is_empty() {
        return Vec::new();
    }
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        by_size.entry(r.size).or_default().push(i);
    }
    let mut candidates: Vec<Vec<String>> = vec![Vec::new(); rows.len()];
    let mut budget = SCAN_MAX_ENTRIES;

    for root in file_identity::candidate_roots() {
        // 提前结束：所有对象都已收集到足够候选（均判定为歧义）或预算耗尽。
        if budget == 0 || candidates.iter().all(|c| c.len() >= MAX_SIGNATURE_CANDIDATES) {
            break;
        }
        scan_dir_tree(&root, &by_size, rows, &mut candidates, &mut budget);
    }

    // 仅回写"恰好唯一命中"的对象。
    candidates
        .into_iter()
        .enumerate()
        .filter_map(|(idx, mut paths)| {
            if paths.len() == 1 {
                Some((rows[idx].id, paths.pop().unwrap()))
            } else {
                None
            }
        })
        .collect()
}

fn scan_dir_tree(
    root: &str,
    by_size: &std::collections::HashMap<u64, Vec<usize>>,
    rows: &[MissingSignatureRow],
    candidates: &mut [Vec<String>],
    budget: &mut usize,
) {
    use std::os::windows::fs::MetadataExt;
    let mut stack: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from(root)];

    while let Some(dir) = stack.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            if *budget == 0 {
                return;
            }
            *budget -= 1;

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            // 跳过 junction/符号链接，避免遍历成环
            if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                continue;
            }

            if meta.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if SCAN_SKIP_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s)) {
                    continue;
                }
                stack.push(entry.path());
            } else if meta.is_file() {
                let indices = match by_size.get(&meta.len()) {
                    Some(v) => v,
                    None => continue, // 大小不匹配，跳过昂贵的哈希
                };
                // 这些候选对象若都已收集满，跳过昂贵的哈希。
                if indices
                    .iter()
                    .all(|&idx| candidates[idx].len() >= MAX_SIGNATURE_CANDIDATES)
                {
                    continue;
                }
                let path = entry.path();
                let path_str = path.to_string_lossy().to_string();
                let sig = match file_identity::compute_signature(&path_str) {
                    Some(s) => s,
                    None => continue,
                };
                for &idx in indices {
                    if candidates[idx].len() >= MAX_SIGNATURE_CANDIDATES {
                        continue;
                    }
                    if rows[idx].head == sig.head_hash && rows[idx].tail == sig.tail_hash {
                        candidates[idx].push(path_str.clone());
                    }
                }
            }
        }
    }
}

/// 将扫描命中的新路径回写：重算文件身份/签名/type、更新位置并清除失效标记。
/// 整批包在单事务里提交（与 apply_reconcile 同一策略，避免逐条自动提交的半截状态），
/// 计数按实际影响行数统计；单条失败（极少数身份冲突）记日志跳过，不阻断整批。
pub fn apply_signature_relocations(
    conn: &Connection,
    found: &[(i64, String)],
) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for (id, new_path) in found {
        let (vol, fid) = match file_identity::get_identity(new_path) {
            Some(i) => (Some(i.volume_serial as i64), Some(i.file_id_hex())),
            None => (None, None),
        };
        let sig = file_identity::compute_signature(new_path);
        match tx.execute(
            "UPDATE items SET path = ?1, name = ?2, type = ?3, volume_serial = ?4, file_id = ?5, \
             sig_size = ?6, sig_head = ?7, sig_tail = ?8, is_missing = 0 WHERE id = ?9",
            params![
                new_path,
                get_name(new_path),
                detect_type(new_path),
                vol,
                fid,
                sig.map(|s| s.size as i64),
                sig.map(|s| s.head_hash as i64),
                sig.map(|s| s.tail_hash as i64),
                id
            ],
        ) {
            Ok(affected) => count += affected,
            Err(e) => eprintln!("[relocate] 回写对象 {} 失败(可能身份冲突): {}", id, e),
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk");
        schema::create_tables(&conn).expect("schema");
        conn
    }

    #[test]
    fn add_item_dedupes_by_path_when_no_file_identity() {
        // 不存在的路径取不到文件ID，走"按 path 去重"分支
        let conn = setup();
        let p = r"D:\__tl_test_nonexistent__\a.exe";
        let a = add_item(&conn, p).expect("add 1");
        let b = add_item(&conn, p).expect("add 2");
        assert_eq!(a.id, b.id, "同一不存在路径应去重为同一条记录");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn in_queries_chunk_beyond_variable_limit() {
        // 插入 600 条（> IN_CHUNK=500）触发分块；验证 get_items_by_ids / remove_items
        // 在超过单条 IN 占位符规模时仍正确（不触发变量上限）、且排序跨块保持。
        let conn = setup();
        {
            let tx = conn.unchecked_transaction().unwrap();
            for i in 0..600i64 {
                tx.execute(
                    "INSERT INTO items (name, path, type, is_favorite) VALUES (?1, ?2, 'exe', ?3)",
                    rusqlite::params![
                        format!("item{:04}", i),
                        format!(r"D:\n\{}.exe", i),
                        if i == 599 { 1i64 } else { 0i64 }
                    ],
                )
                .unwrap();
            }
            tx.commit().unwrap();
        }
        let ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM items").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert_eq!(ids.len(), 600);

        // 分块查询应返回全部对象，且收藏项排在最前（跨块排序生效）。
        let fetched = get_items_by_ids(&conn, &ids).expect("get_items_by_ids > chunk");
        assert_eq!(fetched.len(), 600, "分块查询应返回全部对象");
        assert!(fetched[0].item.is_favorite, "收藏项应排在最前（跨块排序）");
        assert_eq!(fetched[0].item.name, "item0599");

        // 分块删除应清空全部（整体原子）。
        remove_items(&conn, &ids).expect("remove_items > chunk");
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "分块删除应清空");
    }

    #[test]
    fn remove_items_deletes_all_given_ids_atomically() {
        let conn = setup();
        let a = add_item(&conn, r"D:\__tl_test__\1.exe").unwrap();
        let b = add_item(&conn, r"D:\__tl_test__\2.exe").unwrap();
        let c = add_item(&conn, r"D:\__tl_test__\3.exe").unwrap();
        remove_items(&conn, &[a.id, c.id]).expect("batch remove");
        let remaining: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM items ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert_eq!(remaining, vec![b.id]);
    }

    #[test]
    fn reconcile_marks_missing_for_nonexistent_path_without_identity() {
        let conn = setup();
        let a = add_item(&conn, r"D:\__tl_test_missing__\x.exe").unwrap();
        let before: i64 = conn
            .query_row("SELECT is_missing FROM items WHERE id=?1", [a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 0);
        reconcile_items(&conn).expect("reconcile");
        let after: i64 = conn
            .query_row("SELECT is_missing FROM items WHERE id=?1", [a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 1, "路径不存在且无文件ID应标记失效");
    }

    #[test]
    fn detect_type_supports_audio_without_common_video_containers() {
        assert_eq!(detect_type(r"D:\Music\track.mp3"), "audio");
        assert_eq!(detect_type(r"D:\Music\track.FLAC"), "audio");
        assert_eq!(detect_type(r"D:\Music\track.m4a"), "audio");
        assert_eq!(detect_type(r"D:\Video\clip.mp4"), "exe");
        assert_eq!(detect_type(r"D:\Video\clip.m4v"), "exe");
        assert_eq!(detect_type(r"D:\Music\track.wma"), "exe");
    }

    #[test]
    fn detect_type_keeps_existing_file_types() {
        assert_eq!(detect_type(r"D:\Images\cover.png"), "image");
        assert_eq!(detect_type(r"D:\Apps\tool.exe"), "exe");
        assert_eq!(detect_type(r"D:\Scripts\build.cmd"), "bat");
        assert_eq!(detect_type(r"D:\Scripts\profile.ps1"), "ps1");
    }

    #[test]
    fn scan_dir_tree_finds_relocated_file_by_signature() {
        use std::collections::HashMap;
        let base = std::env::temp_dir().join(format!("tl_relocate_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let target = base.join("sub").join("moved.bin");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let data: Vec<u8> = (0..50_000u32).map(|i| (i % 97) as u8).collect();
        std::fs::write(&target, &data).unwrap();

        let target_str = target.to_string_lossy().to_string();
        let sig = file_identity::compute_signature(&target_str).expect("sig");
        let rows = vec![MissingSignatureRow {
            id: 42,
            size: sig.size,
            head: sig.head_hash,
            tail: sig.tail_hash,
        }];
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        by_size.insert(sig.size, vec![0usize]);
        let mut candidates: Vec<Vec<String>> = vec![Vec::new()];
        let mut budget = 1_000_000usize;

        scan_dir_tree(
            &base.to_string_lossy(),
            &by_size,
            &rows,
            &mut candidates,
            &mut budget,
        );

        assert_eq!(candidates[0].len(), 1, "应按内容签名找回唯一文件");
        assert!(candidates[0][0].to_lowercase().ends_with("moved.bin"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn scan_for_signatures_skips_ambiguous_multi_candidate() {
        // 同一签名（内容相同）复制到两个文件 → 命中多候选，应判为歧义、不自动回写。
        let base = std::env::temp_dir().join(format!("tl_ambig_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let data: Vec<u8> = (0..60_000u32).map(|i| (i % 101) as u8).collect();
        let a = base.join("a.bin");
        let b = base.join("nested").join("b.bin");
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();
        std::fs::write(&a, &data).unwrap();
        std::fs::write(&b, &data).unwrap();

        let sig = file_identity::compute_signature(&a.to_string_lossy()).expect("sig");
        let rows = vec![MissingSignatureRow {
            id: 7,
            size: sig.size,
            head: sig.head_hash,
            tail: sig.tail_hash,
        }];

        // 用内部遍历直接验证候选收集（scan_for_signatures 走全盘遍历，测试里用 scan_dir_tree 定向）。
        use std::collections::HashMap;
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        by_size.insert(sig.size, vec![0usize]);
        let mut candidates: Vec<Vec<String>> = vec![Vec::new()];
        let mut budget = 1_000_000usize;
        scan_dir_tree(&base.to_string_lossy(), &by_size, &rows, &mut candidates, &mut budget);

        assert!(candidates[0].len() >= 2, "同签名多文件应收集到多个候选");
        // 多候选 → filter 只保留唯一命中，故不产出回写项。
        let unique: Vec<_> = candidates
            .into_iter()
            .enumerate()
            .filter_map(|(idx, mut p)| if p.len() == 1 { Some((rows[idx].id, p.pop().unwrap())) } else { None })
            .collect();
        assert!(unique.is_empty(), "歧义命中不应自动回写");

        let _ = std::fs::remove_dir_all(&base);
    }
}
