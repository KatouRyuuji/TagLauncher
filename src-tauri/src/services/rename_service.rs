//! 对象重命名：同时修改磁盘上的真实名称与库内记录（路径、名称、类型）。
//!
//! 流程：短锁读取对象 → 锁外校验名称与目标冲突（`dry_run` 到此返回）→ 逐个对象在同一段短锁内
//! 改磁盘并写库。改磁盘用 `MoveFileExW` 且不带 `MOVEFILE_REPLACE_EXISTING`，由系统保证不覆盖已有文件；
//! 写库失败时把磁盘名改回。改磁盘与写库处于同一段锁内，对账与监视补扫无法插入两者之间。

use crate::db::Database;
use crate::services::{file_identity, item_service};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS, ERROR_FILE_NOT_FOUND,
    ERROR_PATH_NOT_FOUND, ERROR_SHARING_VIOLATION, ERROR_WRITE_PROTECT,
};
use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

/// 单段名称上限（UTF-16 码元，NTFS 限制）。
const NAME_MAX_UNITS: usize = 255;
/// 共享冲突（文件被占用）时的退避时长，只重试一次。
const SHARING_RETRY_DELAY: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRequest {
    pub id: i64,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenamedItem {
    pub id: i64,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameFailure {
    pub id: i64,
    pub error: String,
}

/// 重命名结果：`dry_run` 时 `renamed` 为可执行的计划；名称未变的对象不出现在任一列表。
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReport {
    pub renamed: Vec<RenamedItem>,
    pub failed: Vec<RenameFailure>,
}

/// 校验单段文件名是否可在 Windows 上使用。
pub fn validate_file_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    if name == "." || name == ".." {
        return Err("名称不能是 . 或 ..".to_string());
    }
    if name.chars().any(|c| (c as u32) < 0x20 || "<>:\"/\\|?*".contains(c)) {
        return Err("名称不能包含 \\ / : * ? \" < > | 或控制字符".to_string());
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err("名称不能以空格或点结尾".to_string());
    }
    let base = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && matches!(base.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        return Err(format!("「{}」是系统保留名称", base));
    }
    if name.encode_utf16().count() > NAME_MAX_UNITS {
        return Err(format!("名称过长（最多 {} 个字符）", NAME_MAX_UNITS));
    }
    Ok(())
}

/// 已通过校验、待执行的单个改名。
struct Planned {
    id: i64,
    old_path: String,
    new_path: String,
    new_name: String,
    new_type: &'static str,
    is_folder: bool,
}

/// 对象路径去掉末尾分隔符后，拆成（父目录前缀含分隔符, 当前名称）。
fn split_parent(path: &str) -> Option<(&str, &str)> {
    let trimmed = path.trim_end_matches(['\\', '/']);
    let idx = trimmed.rfind(['\\', '/'])?;
    let name = &trimmed[idx + 1..];
    if name.is_empty() || name.ends_with(':') {
        return None;
    }
    Some((&trimmed[..=idx], name))
}

fn plan_one(
    id: i64,
    path: &str,
    item_type: &str,
    is_missing: bool,
    new_name: &str,
) -> Result<Option<Planned>, String> {
    if is_missing {
        return Err("失效对象不能重命名，请先处理失效".to_string());
    }
    validate_file_name(new_name)?;
    let (parent, current) = split_parent(path).ok_or_else(|| "磁盘根目录不能重命名".to_string())?;
    if current == new_name {
        return Ok(None);
    }
    let old_path = format!("{}{}", parent, current);
    let new_path = format!("{}{}", parent, new_name);
    if std::fs::symlink_metadata(&old_path).is_err() {
        return Err("找不到原文件，可能已被移动或删除".to_string());
    }
    // 目标已存在时只放行「同一个对象只改大小写」
    if std::fs::symlink_metadata(&new_path).is_ok() {
        let same_object = old_path.to_lowercase() == new_path.to_lowercase()
            && match (file_identity::get_identity(&old_path), file_identity::get_identity(&new_path)) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            };
        if !same_object {
            return Err(format!("「{}」已存在", new_name));
        }
    }
    let is_folder = item_type == "folder";
    let new_type = if is_folder {
        "folder"
    } else {
        let ext = Path::new(new_name).extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase());
        item_service::classify_by_extension(ext.as_deref())
    };
    Ok(Some(Planned {
        id,
        old_path,
        new_path,
        new_name: new_name.to_string(),
        new_type,
        is_folder,
    }))
}

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// 同目录改名，不覆盖已存在的目标；失败返回 Win32 错误码。
fn move_no_replace(src: &str, dst: &str) -> Result<(), u32> {
    let (src_w, dst_w) = (wide(src), wide(dst));
    if unsafe { MoveFileExW(src_w.as_ptr(), dst_w.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(unsafe { GetLastError() })
    }
}

fn move_error_text(code: u32, new_name: &str) -> String {
    match code {
        ERROR_FILE_EXISTS | ERROR_ALREADY_EXISTS => format!("「{}」已存在", new_name),
        ERROR_SHARING_VIOLATION => "文件正被其他程序占用，请关闭后重试".to_string(),
        ERROR_ACCESS_DENIED => "没有权限重命名，或文件正被占用".to_string(),
        ERROR_WRITE_PROTECT => "磁盘处于写保护状态".to_string(),
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => "找不到原文件，可能已被移动或删除".to_string(),
        other => format!("重命名失败（系统错误码 {}）", other),
    }
}

/// 在已持有的连接上写库：对象本身按原路径守卫；文件夹同时替换库内子对象的路径前缀。
fn write_rename(conn: &mut rusqlite::Connection, p: &Planned) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE items SET path = ?1, name = ?2, type = ?3 WHERE id = ?4 AND rtrim(path, '\\/') = ?5 AND is_missing = 0",
            params![p.new_path, p.new_name, p.new_type, p.id, p.old_path],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("对象记录已变化".to_string());
    }
    if p.is_folder {
        // 前缀后必须紧跟分隔符，避免误改 D:\ab 这类同名前缀的兄弟目录
        let old_len = p.old_path.chars().count() as i64;
        tx.execute(
            "UPDATE items SET path = ?1 || substr(path, ?2 + 1) \
             WHERE id != ?3 AND lower(substr(path, 1, ?2)) = lower(?4) AND substr(path, ?2 + 1, 1) IN ('\\', '/')",
            params![p.new_path, old_len, p.id, p.old_path],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// 执行单个改名：同一段锁内改磁盘并写库；仅共享冲突时释放锁退避后重试一次。
fn execute_one(db: &Database, p: &Planned) -> Result<(), String> {
    let mut attempt = 0;
    loop {
        let mut conn = db.get_conn();
        let current: Option<(String, i64)> = conn
            .query_row("SELECT path, is_missing FROM items WHERE id = ?1", [p.id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        match current {
            Some((path, 0)) if path.trim_end_matches(['\\', '/']) == p.old_path => {}
            Some(_) => return Err("对象已变化，请刷新后重试".to_string()),
            None => return Err(format!("对象不存在（id {}），可能已被删除", p.id)),
        }
        match move_no_replace(&p.old_path, &p.new_path) {
            Ok(()) => {}
            Err(ERROR_SHARING_VIOLATION) if attempt == 0 => {
                attempt += 1;
                drop(conn);
                std::thread::sleep(SHARING_RETRY_DELAY);
                continue;
            }
            Err(code) => return Err(move_error_text(code, &p.new_name)),
        }
        return match write_rename(&mut conn, p) {
            Ok(()) => Ok(()),
            Err(e) => match move_no_replace(&p.new_path, &p.old_path) {
                Ok(()) => Err(format!("写入数据库失败（{}），已将磁盘名称改回", e)),
                Err(_) => Err(format!("写入数据库失败（{}），磁盘名称未能改回，下次对账会按文件身份同步", e)),
            },
        };
    }
}

/// 重命名一批对象；`dry_run` 只做校验与冲突检查，不改磁盘与数据库。
pub fn rename_items(db: &Database, renames: Vec<RenameRequest>, dry_run: bool) -> Result<RenameReport, String> {
    if !dry_run {
        crate::db::ensure_writes_allowed()?;
    }
    let mut report = RenameReport::default();
    let rows: Vec<(RenameRequest, Option<(String, String, i64)>)> = {
        let conn = db.get_conn();
        let mut stmt = conn
            .prepare("SELECT path, type, is_missing FROM items WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        renames
            .into_iter()
            .map(|req| {
                let row = stmt
                    .query_row([req.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .optional()
                    .map_err(|e| e.to_string())?;
                Ok((req, row))
            })
            .collect::<Result<_, String>>()?
    };

    let mut planned: Vec<Planned> = Vec::new();
    for (req, row) in rows {
        let Some((path, item_type, is_missing)) = row else {
            report.failed.push(RenameFailure { id: req.id, error: format!("对象不存在（id {}），可能已被删除", req.id) });
            continue;
        };
        match plan_one(req.id, &path, &item_type, is_missing != 0, &req.new_name) {
            Ok(Some(p)) => {
                let target = p.new_path.to_lowercase();
                if planned.iter().any(|q| q.new_path.to_lowercase() == target) {
                    report.failed.push(RenameFailure { id: req.id, error: format!("与同批其他对象重名：「{}」", p.new_name) });
                } else {
                    planned.push(p);
                }
            }
            Ok(None) => {}
            Err(error) => report.failed.push(RenameFailure { id: req.id, error }),
        }
    }

    for p in planned {
        let result = if dry_run { Ok(()) } else { execute_one(db, &p) };
        match result {
            Ok(()) => report.renamed.push(RenamedItem { id: p.id, old_path: p.old_path, new_path: p.new_path }),
            Err(error) => report.failed.push(RenameFailure { id: p.id, error }),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_file_name_rules() {
        for ok in ["报告.docx", "a", " 前导空格.txt", "COM0.txt", "CONSOLE.log", "LPT10", "a.b.c", "x".repeat(255).as_str()] {
            assert!(validate_file_name(ok).is_ok(), "应允许：{ok:?}");
        }
        for bad in ["", "   ", ".", "..", "a<b", "a>b", "a:b", "a\"b", "a/b", "a\\b", "a|b", "a?b", "a*b", "a\u{1}b", "尾空格 ", "尾点.", "CON", "con.txt", "Nul", "COM1", "lpt9.log", "AUX .txt", "x".repeat(256).as_str()] {
            assert!(validate_file_name(bad).is_err(), "应拒绝：{bad:?}");
        }
    }

    #[test]
    fn split_parent_handles_separators_and_roots() {
        assert_eq!(split_parent("D:\\a\\b.txt"), Some(("D:\\a\\", "b.txt")));
        assert_eq!(split_parent("D:/a/b"), Some(("D:/a/", "b")));
        assert_eq!(split_parent("D:\\a\\dir\\"), Some(("D:\\a\\", "dir")));
        assert_eq!(split_parent("D:\\"), None);
        assert_eq!(split_parent("D:"), None);
    }
}
