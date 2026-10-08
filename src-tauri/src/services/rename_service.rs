//! 对象重命名：同时修改磁盘上的真实名称与库内记录（路径、名称、类型）。
//!
//! 流程：短锁读取对象 → 锁外校验名称与目标冲突（`dry_run` 到此返回）→ 逐步在各自的短锁内改磁盘并写库。
//! 改磁盘用 `MoveFileExW` 且不带 `MOVEFILE_REPLACE_EXISTING`，由系统保证不覆盖已有文件；写库失败时把磁盘名改回。
//! 改磁盘与写库处于同一段锁内，对账与监视补扫无法插入两者之间。
//!
//! 同批内目标正好是另一对象原名时（互换、链式改名），按依赖顺序执行：链从末端起依次改名；
//! 成环时先把其中一个对象改为同目录临时名腾出原名，其余对象依次改名后再改为最终名，
//! 环中任一步失败则把已完成的步骤按相反顺序改回原名。各组按路径从深到浅执行，同批的子对象先于所在文件夹改名。

use crate::db::Database;
use crate::services::{file_identity, item_service};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
#[derive(Clone)]
struct Planned {
    id: i64,
    old_path: String,
    new_path: String,
    new_name: String,
    old_type: String,
    new_type: String,
    is_folder: bool,
    /// 目标已被另一个对象占用；只有占用者是同批中会先改走的对象时才可执行。
    target_occupied: bool,
}

impl Planned {
    /// 同一对象的另一步改名（环中转的临时名、改回原名）。
    fn step(&self, old_path: &str, new_path: &str, new_type: &str) -> Planned {
        let new_name = split_parent(new_path).map(|(_, n)| n).unwrap_or(new_path).to_string();
        Planned {
            old_path: old_path.to_string(),
            new_path: new_path.to_string(),
            new_name,
            new_type: new_type.to_string(),
            target_occupied: false,
            ..self.clone()
        }
    }

    fn depth(&self) -> usize {
        self.old_path.matches(['\\', '/']).count()
    }
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
    // 目标已存在且不是「同一个对象只改大小写」时记为被占用，由批内依赖解析决定能否执行
    let target_occupied = std::fs::symlink_metadata(&new_path).is_ok()
        && !(old_path.to_lowercase() == new_path.to_lowercase()
            && match (file_identity::get_identity(&old_path), file_identity::get_identity(&new_path)) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            });
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
        old_type: item_type.to_string(),
        new_type: new_type.to_string(),
        is_folder,
        target_occupied,
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

/// 目标被占用的对象：占用者是同批可执行对象时记下依赖（占用者须先改走），否则判为已存在。
/// 判为已存在会让依赖它的对象失去依赖，因此反复解析直到稳定。
fn resolve_dependencies(mut planned: Vec<Planned>, report: &mut RenameReport) -> (Vec<Planned>, Vec<Option<usize>>) {
    loop {
        let sources: HashMap<String, usize> =
            planned.iter().enumerate().map(|(i, p)| (p.old_path.to_lowercase(), i)).collect();
        let deps: Vec<Option<usize>> = planned
            .iter()
            .enumerate()
            .map(|(i, p)| {
                p.target_occupied
                    .then(|| sources.get(&p.new_path.to_lowercase()).copied().filter(|&j| j != i))
                    .flatten()
            })
            .collect();
        let blocked: Vec<usize> = (0..planned.len()).filter(|&i| planned[i].target_occupied && deps[i].is_none()).collect();
        if blocked.is_empty() {
            return (planned, deps);
        }
        for i in blocked.into_iter().rev() {
            let p = planned.remove(i);
            report.failed.push(RenameFailure { id: p.id, error: format!("「{}」已存在", p.new_name) });
        }
    }
}

/// 执行分组。每个对象至多依赖一个对象、至多被一个对象依赖，依赖关系只构成互不相交的链与环。
enum Group {
    /// 按执行顺序排列：首个对象无依赖，其后每个对象依赖前一个。
    Chain(Vec<usize>),
    /// 首个对象先改为临时名，其后按执行顺序排列，最后首个对象由临时名改为最终名。
    Cycle(Vec<usize>),
}

fn group_steps(planned: &[Planned], deps: &[Option<usize>]) -> Vec<Group> {
    let n = planned.len();
    let mut dependent = vec![None; n];
    for (i, d) in deps.iter().enumerate() {
        if let Some(j) = *d {
            dependent[j] = Some(i);
        }
    }
    let mut visited = vec![false; n];
    let follow = |start: usize, visited: &mut Vec<bool>| {
        let mut order = vec![start];
        visited[start] = true;
        let mut cur = dependent[start];
        while let Some(i) = cur.filter(|&i| !visited[i]) {
            visited[i] = true;
            order.push(i);
            cur = dependent[i];
        }
        order
    };
    let mut groups: Vec<(usize, Group)> = Vec::new();
    for i in 0..n {
        if deps[i].is_none() {
            groups.push((planned[i].depth(), Group::Chain(follow(i, &mut visited))));
        }
    }
    for i in 0..n {
        if !visited[i] {
            groups.push((planned[i].depth(), Group::Cycle(follow(i, &mut visited))));
        }
    }
    groups.sort_by_key(|(depth, _)| std::cmp::Reverse(*depth));
    groups.into_iter().map(|(_, g)| g).collect()
}

/// 环中转用的临时名：同目录下 `原名.tl-<id>.tmp`，已存在时追加序号，超长时改用 `tl-<id>.tmp`。
fn temp_path(p: &Planned) -> Option<String> {
    let (parent, current) = split_parent(&p.old_path)?;
    (0..100)
        .map(|n| {
            let suffix = if n == 0 { String::new() } else { format!("-{}", n) };
            let name = format!("{}.tl-{}{}.tmp", current, p.id, suffix);
            let name = if name.encode_utf16().count() > NAME_MAX_UNITS { format!("tl-{}{}.tmp", p.id, suffix) } else { name };
            format!("{}{}", parent, name)
        })
        .find(|path| std::fs::symlink_metadata(path).is_err())
}

fn push_renamed(report: &mut RenameReport, p: &Planned) {
    report.renamed.push(RenamedItem { id: p.id, old_path: p.old_path.clone(), new_path: p.new_path.clone() });
}

fn push_failed(report: &mut RenameReport, p: &Planned, error: String) {
    report.failed.push(RenameFailure { id: p.id, error });
}

fn execute_chain(db: &Database, planned: &[Planned], order: &[usize], report: &mut RenameReport) {
    let mut blocked = false;
    for &i in order {
        let p = &planned[i];
        if blocked {
            push_failed(report, p, format!("「{}」被同批中改名失败的对象占用，未执行", p.new_name));
            continue;
        }
        match execute_one(db, p) {
            Ok(()) => push_renamed(report, p),
            Err(e) => {
                blocked = true;
                push_failed(report, p, e);
            }
        }
    }
}

fn execute_cycle(db: &Database, planned: &[Planned], order: &[usize], report: &mut RenameReport) {
    const NOT_RUN: &str = "同批交换中的其他对象改名失败，未执行";
    const ROLLED_BACK: &str = "同批交换中的其他对象改名失败，已改回原名";
    let first = &planned[order[0]];
    let rest = &order[1..];

    let to_temp = match temp_path(first) {
        Some(temp) => first.step(&first.old_path, &temp, &first.old_type),
        None => {
            push_failed(report, first, "无法生成交换用的临时名称".to_string());
            rest.iter().for_each(|&i| push_failed(report, &planned[i], NOT_RUN.to_string()));
            return;
        }
    };
    if let Err(e) = execute_one(db, &to_temp) {
        push_failed(report, first, e);
        rest.iter().for_each(|&i| push_failed(report, &planned[i], NOT_RUN.to_string()));
        return;
    }

    let mut done = 0;
    let mut failure: Option<(usize, String)> = None;
    for (k, &i) in rest.iter().enumerate() {
        match execute_one(db, &planned[i]) {
            Ok(()) => done += 1,
            Err(e) => {
                failure = Some((k, e));
                break;
            }
        }
    }
    let first_error = if failure.is_none() {
        match execute_one(db, &first.step(&to_temp.new_path, &first.new_path, &first.new_type)) {
            Ok(()) => {
                push_renamed(report, first);
                rest.iter().for_each(|&i| push_renamed(report, &planned[i]));
                return;
            }
            Err(e) => Some(e),
        }
    } else {
        None
    };

    // 失败：记录失败项与未执行项，再把已完成的步骤按相反顺序改回，最后把首个对象由临时名改回原名
    if let Some((k, e)) = failure {
        push_failed(report, &planned[rest[k]], e);
        rest[k + 1..].iter().for_each(|&i| push_failed(report, &planned[i], NOT_RUN.to_string()));
    }
    let mut restored = true;
    for &i in rest[..done].iter().rev() {
        let p = &planned[i];
        if restored && execute_one(db, &p.step(&p.new_path, &p.old_path, &p.old_type)).is_ok() {
            push_failed(report, p, ROLLED_BACK.to_string());
        } else {
            restored = false;
            push_renamed(report, p);
        }
    }
    let back = restored && execute_one(db, &first.step(&to_temp.new_path, &first.old_path, &first.old_type)).is_ok();
    let reason = first_error.unwrap_or_else(|| "同批交换中的其他对象改名失败".to_string());
    let error = if back {
        format!("{}，已改回原名", reason)
    } else {
        let temp_name = split_parent(&to_temp.new_path).map(|(_, n)| n).unwrap_or_default();
        format!("{}；对象暂留临时名「{}」，请手动改名", reason, temp_name)
    };
    push_failed(report, first, error);
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
    let mut targets: HashSet<String> = HashSet::new();
    for (req, row) in rows {
        let Some((path, item_type, is_missing)) = row else {
            report.failed.push(RenameFailure { id: req.id, error: format!("对象不存在（id {}），可能已被删除", req.id) });
            continue;
        };
        match plan_one(req.id, &path, &item_type, is_missing != 0, &req.new_name) {
            Ok(Some(p)) => {
                if !targets.insert(p.new_path.to_lowercase()) {
                    report.failed.push(RenameFailure { id: req.id, error: format!("与同批其他对象重名：「{}」", p.new_name) });
                } else {
                    planned.push(p);
                }
            }
            Ok(None) => {}
            Err(error) => report.failed.push(RenameFailure { id: req.id, error }),
        }
    }
    let (planned, deps) = resolve_dependencies(planned, &mut report);

    if dry_run {
        planned.iter().for_each(|p| push_renamed(&mut report, p));
        return Ok(report);
    }
    for group in group_steps(&planned, &deps) {
        match group {
            Group::Chain(order) => execute_chain(db, &planned, &order, &mut report),
            Group::Cycle(order) => execute_cycle(db, &planned, &order, &mut report),
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
