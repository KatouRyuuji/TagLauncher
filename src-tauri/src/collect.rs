//! 收纳会话（全局极速阶段③）：资源管理器右键「用 TagLauncher 收纳…」、「发送到」把路径交给
//! 本进程，合并成一个会话后弹快速窗让用户选动作（打标签 / 放入文件柜 / 仅导入）。
//!
//! - 经典动词多选时每个选中项各起一个进程（`--collect "%1"`），单实例插件把参数转给主实例；
//!   主实例在 [`QUIET`] 静默窗口内把同一批合并成一个会话，只弹一次。「发送到」一次带全部路径。
//! - 会话进行中（快速窗还没处理完）又来的路径并入同一会话（去重），快速窗收到更新。
//! - 参数只当路径数据：去引号与空白、必须是存在的绝对路径、按不区分大小写去重，总数上限
//!   [`MAX_COLLECT`]，绝不执行。
//! - 写入不在这里做：快速窗按动作调用与主窗相同的导入命令（add_items + 导入上下文），
//!   提交后由 data_sync 广播 data-changed。
//! - 「记住本次选择」存设置 `collect.remember`，下次收纳由快速窗直接按它执行。

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::services::settings_service;
use crate::Database;

pub const QUICK_COLLECT_EVENT: &str = "quick-collect";
pub const COLLECT_ARG: &str = crate::shell_integration::COLLECT_ARG;
/// 每项一进程时，后续进程到达的间隔一般是几十毫秒；400ms 内没有新到达就算一批
pub const QUIET: Duration = Duration::from_millis(400);
/// 一次会话最多收纳的路径数
pub const MAX_COLLECT: usize = 1000;
pub const PREF_KEY: &str = "collect.remember";

/// 取出 `--collect` 之后的全部参数（它们都是路径数据）。没有 `--collect` 返回 None。
pub fn collect_args<I, S>(args: I) -> Option<Vec<String>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut it = args.into_iter();
    it.by_ref().find(|a| a.as_ref() == COLLECT_ARG)?;
    Some(it.map(|a| a.as_ref().to_string()).collect())
}

pub(crate) fn path_key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// 规范化一个参数：去两端空白与引号；必须是绝对路径且存在。
pub fn normalize_arg(raw: &str) -> Option<String> {
    let s = raw.trim().trim_matches('"').trim();
    if s.is_empty() {
        return None;
    }
    let p = Path::new(s);
    if !p.is_absolute() || !p.exists() {
        return None;
    }
    // 去掉末尾分隔符（盘符根 "C:\" 保留）
    let trimmed = s.trim_end_matches(['\\', '/']);
    let out = if trimmed.ends_with(':') || trimmed.is_empty() {
        s.to_string()
    } else {
        trimmed.to_string()
    };
    Some(out)
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectSession {
    /// 会话编号：处理完（collect_finish）后下一批换新编号
    pub id: u64,
    pub paths: Vec<String>,
    /// 合并了几次调用（每项一进程时 = 选中项数）
    pub invocations: u32,
    /// 被丢弃的无效参数数（不存在、不是绝对路径）
    pub invalid: u32,
    /// 超过上限被截断
    pub truncated: bool,
    /// 第一批到达时刻（Unix 毫秒）
    pub started_ms: u64,
}

#[derive(Default)]
struct Inner {
    session: CollectSession,
    keys: HashSet<String>,
    /// 每次到达自增：静默窗口结束时只有最后一次到达负责弹出
    arrival: u64,
    next_id: u64,
}

impl Inner {
    /// 并入一批参数（纯逻辑，便于单测）。返回这次到达的序号。
    fn merge(&mut self, raw: &[String], now_ms: u64) -> u64 {
        if self.session.id == 0 {
            self.next_id += 1;
            self.session.id = self.next_id;
            self.session.started_ms = now_ms;
        }
        self.session.invocations += 1;
        for arg in raw {
            let Some(path) = normalize_arg(arg) else {
                self.session.invalid += 1;
                continue;
            };
            if !self.keys.insert(path_key(&path)) {
                continue;
            }
            if self.session.paths.len() >= MAX_COLLECT {
                self.session.truncated = true;
                continue;
            }
            self.session.paths.push(path);
        }
        self.arrival += 1;
        self.arrival
    }

    /// 处理完会话的前 `handled` 条；之后到达的保留为下一个会话。返回是否还有剩余。
    fn finish(&mut self, id: u64, handled: usize) -> bool {
        if self.session.id != id {
            return self.session.id != 0;
        }
        let rest: Vec<String> = self
            .session
            .paths
            .split_off(handled.min(self.session.paths.len()));
        self.keys = rest.iter().map(|p| path_key(p)).collect();
        if rest.is_empty() {
            self.session = CollectSession::default();
            return false;
        }
        self.next_id += 1;
        self.session = CollectSession {
            id: self.next_id,
            paths: rest,
            invocations: 1,
            invalid: 0,
            truncated: false,
            started_ms: crate::quick::now_ms(),
        };
        true
    }
}

#[derive(Default)]
pub struct CollectState {
    inner: Mutex<Inner>,
}

impl CollectState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Option<CollectSession> {
        let inner = self.lock();
        (inner.session.id != 0).then(|| inner.session.clone())
    }
}

/// E2E 用：debug 构建且设了 TAGLAUNCHER_E2E_NO_ACTIVATE 时弹快速窗不抢前台（测试机守护不允许）
fn activate_on_show() -> bool {
    !(cfg!(debug_assertions) && std::env::var_os("TAGLAUNCHER_E2E_NO_ACTIVATE").is_some())
}

/// 收到一批路径（首个实例的启动参数，或单实例转发来的参数）。静默窗口后弹出。
pub fn submit(app: &AppHandle, raw: Vec<String>) {
    let Some(state) = app.try_state::<CollectState>() else {
        return;
    };
    let arrival = state.lock().merge(&raw, crate::quick::now_ms());
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-collect".into())
        .spawn(move || {
            std::thread::sleep(QUIET);
            let state = app.state::<CollectState>();
            if state.lock().arrival != arrival {
                return; // 之后又有到达，由最后一次负责
            }
            present(&app);
        });
}

/// 立即并入并弹出：拖入、剪贴板、热键 B 的来源本身就是一份完整列表，不需要等静默窗口。
/// 只并入有效路径；一条有效路径都没有时不建会话，返回 None。
pub fn submit_now(app: &AppHandle, raw: Vec<String>) -> Option<CollectSession> {
    let state = app.try_state::<CollectState>()?;
    if !raw.iter().any(|p| normalize_arg(p).is_some()) {
        return None;
    }
    // 并入后递增 arrival：之前右键菜单留下的静默线程看到序号变化就不再弹出，由这里负责
    state.lock().merge(&raw, crate::quick::now_ms());
    let snapshot = state.snapshot();
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-collect-now".into())
        .spawn(move || present(&app));
    snapshot
}

/// 把当前会话交给快速窗（必要时创建窗口）。在非主线程调用。
fn present(app: &AppHandle) {
    let Some(session) = app.state::<CollectState>().snapshot() else {
        return;
    };
    if let Err(e) = crate::quick::show(app, session.started_ms, activate_on_show()) {
        log::warn!("[collect] 弹出快速窗失败：{e}");
        return;
    }
    if let Some(w) = app.get_webview_window(crate::quick::QUICK_LABEL) {
        let _ = w.emit(QUICK_COLLECT_EVENT, &session);
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CollectAction {
    Tag,
    Cabinet,
    Import,
}

/// 记住的收纳选择
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectPreference {
    pub action: CollectAction,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    #[serde(default)]
    pub cabinet_id: Option<i64>,
    /// 含文件夹时的导入方式：folder / contents / both（与主窗导入对话框同义）
    #[serde(default)]
    pub folder_mode: Option<String>,
}

impl CollectPreference {
    pub fn validate(&self) -> Result<(), String> {
        match self.action {
            CollectAction::Tag if self.tag_ids.is_empty() => {
                return Err("记住「打标签」需要至少一个标签".into())
            }
            CollectAction::Cabinet if self.cabinet_id.is_none() => {
                return Err("记住「放入文件柜」需要指定文件柜".into())
            }
            _ => {}
        }
        match self.folder_mode.as_deref() {
            None | Some("folder" | "contents" | "both") => Ok(()),
            Some(other) => Err(format!("未知的文件夹导入方式「{other}」")),
        }
    }
}

pub fn read_preference(conn: &rusqlite::Connection) -> Option<CollectPreference> {
    let raw = settings_service::get_setting(conn, PREF_KEY)?;
    if raw.trim().is_empty() {
        return None;
    }
    serde_json::from_str::<CollectPreference>(&raw)
        .ok()
        .filter(|p| p.validate().is_ok())
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 快速窗启动或收到事件时拉取当前会话（窗口刚创建时可能错过事件）
#[tauri::command]
pub fn collect_session(state: State<CollectState>) -> Option<CollectSession> {
    state.snapshot()
}

/// 快速窗处理完（或取消）会话：清掉前 handled 条；处理期间新到的路径作为下一个会话再弹出。
/// 快速搜索功能没开时，收纳完销毁窗口，不常驻。
#[tauri::command]
pub fn collect_finish(app: AppHandle, state: State<CollectState>, id: u64, handled: usize) {
    let more = state.lock().finish(id, handled);
    if more {
        let app = app.clone();
        std::thread::spawn(move || present(&app));
        return;
    }
    crate::quick::hide(&app);
    if !crate::desktop::quick_enabled(&app) {
        let app = app.clone();
        std::thread::spawn(move || {
            // 等本次 invoke 回包送达后再销毁
            std::thread::sleep(Duration::from_millis(300));
            if app.state::<CollectState>().snapshot().is_none()
                && !crate::desktop::quick_enabled(&app)
            {
                // 与关闭快速搜索同一路径：在主线程销毁
                let handle = app.clone();
                let destroy = move || crate::quick::destroy_window(&handle);
                if let Err(e) = app.run_on_main_thread(destroy) {
                    log::warn!("[collect] 销毁快速窗失败：{e}");
                }
            }
        });
    }
}

/// 快速窗发起的收纳（拖入文件、收纳剪贴板）：路径只当数据处理，与右键参数同一套校验。
#[tauri::command]
pub fn collect_submit(app: AppHandle, paths: Vec<String>) -> Result<CollectSession, String> {
    submit_now(&app, paths).ok_or_else(|| "没有可收纳的项目：需要是存在的文件或文件夹".to_string())
}

#[tauri::command]
pub fn get_collect_preference(db: State<Database>) -> Option<CollectPreference> {
    read_preference(&db.get_conn())
}

/// 保存（Some）或清除（None）记住的收纳选择
#[tauri::command]
pub fn set_collect_preference(
    db: State<Database>,
    preference: Option<CollectPreference>,
) -> Result<Option<CollectPreference>, String> {
    let conn = db.get_conn();
    match &preference {
        Some(p) => {
            p.validate()?;
            let raw = serde_json::to_string(p).map_err(|e| e.to_string())?;
            settings_service::set_setting(&conn, PREF_KEY, &raw)?;
        }
        None => settings_service::set_setting(&conn, PREF_KEY, "")?,
    }
    Ok(read_preference(&conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_files(tag: &str, n: usize) -> (std::path::PathBuf, Vec<String>) {
        let dir = std::env::temp_dir().join(format!("tl_collect_{}_{tag}_{n}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let files = (0..n)
            .map(|i| {
                let p = dir.join(format!("f{i}.txt"));
                std::fs::write(&p, b"x").unwrap();
                p.to_string_lossy().to_string()
            })
            .collect();
        (dir, files)
    }

    #[test]
    fn collect_args_take_everything_after_flag() {
        assert_eq!(collect_args(["--show"]), None);
        assert_eq!(
            collect_args(["--background", "--collect", "D:\\a b.txt", "--show"]),
            Some(vec!["D:\\a b.txt".to_string(), "--show".to_string()])
        );
        assert_eq!(collect_args(["--collect"]), Some(vec![]));
    }

    #[test]
    fn merge_dedupes_drops_invalid_and_keeps_one_session() {
        let (dir, files) = tmp_files("merge", 3);
        let mut inner = Inner::default();
        // 每项一进程：三次到达并入同一会话
        let a1 = inner.merge(&[files[0].clone()], 1);
        inner.merge(&[format!("\"{}\"", files[1])], 2);
        let a3 = inner.merge(
            &[
                files[2].clone(),
                files[0].clone(),
                "relative.txt".into(),
                "C:\\不存在\\x".into(),
            ],
            3,
        );
        assert!(a3 > a1);
        assert_eq!(inner.session.paths, files);
        assert_eq!(inner.session.invocations, 3);
        assert_eq!(inner.session.invalid, 2);
        assert_eq!(inner.session.started_ms, 1);
        let id = inner.session.id;
        // 处理了前 2 条时第 3 条才到：剩下的成为下一个会话
        assert!(inner.finish(id, 2));
        assert_ne!(inner.session.id, id);
        assert_eq!(inner.session.paths, vec![files[2].clone()]);
        assert!(!inner.finish(inner.session.id, 1));
        assert_eq!(inner.session.id, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn merge_caps_session_size() {
        let (dir, files) = tmp_files("finish", 3);
        let mut inner = Inner::default();
        inner.session.paths = (0..MAX_COLLECT).map(|i| format!("X:\\{i}")).collect();
        inner.session.id = 1;
        inner.merge(&files, 0);
        assert_eq!(inner.session.paths.len(), MAX_COLLECT);
        assert!(inner.session.truncated);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn preference_requires_target_for_tag_and_cabinet() {
        let p = |action, tag_ids: Vec<i64>, cabinet_id| CollectPreference {
            action,
            tag_ids,
            cabinet_id,
            folder_mode: None,
        };
        assert!(p(CollectAction::Import, vec![], None).validate().is_ok());
        assert!(p(CollectAction::Tag, vec![], None).validate().is_err());
        assert!(p(CollectAction::Tag, vec![1], None).validate().is_ok());
        assert!(p(CollectAction::Cabinet, vec![], None).validate().is_err());
        let mut bad = p(CollectAction::Import, vec![], None);
        bad.folder_mode = Some("everything".into());
        assert!(bad.validate().is_err());
        let json = serde_json::to_string(&p(CollectAction::Cabinet, vec![], Some(3))).unwrap();
        assert_eq!(
            json,
            r#"{"action":"cabinet","tagIds":[],"cabinetId":3,"folderMode":null}"#
        );
    }
}
