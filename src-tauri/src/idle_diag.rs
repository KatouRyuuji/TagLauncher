//! 只读空闲诊断：用隐藏的 message-only 窗口接收 WM_COPYDATA，在 CPU 采样窗口之外
//! 做一次 COM 异步进程扩展信息快照，并用
//! `ICoreWebView2_20::FrameId` ↔ `ICoreWebView2FrameInfo2::FrameId` 关联窗口与渲染进程。
//!
//! 硬约束（不得破）：
//! - 不执行 JS、不改 IsVisible / focus / DWM / 窗口显示，不做周期轮询；
//! - 接口缺失、FrameId=0、快照与导航/销毁不同步时映射为 UNKNOWN，不按 URL 或创建顺序猜测；
//! - 一个 renderer 可以对应多个 frame/window；
//! - 结束快照必须在重新挂上 CDP 之前由调用方触发；本模块不重建 CDP。
//! - 默认关闭：仅当 TL_IDLE_DIAG=1 且 TL_IDLE_DIAG_DIR 指向合法绝对目录时才安装窗口。
//!   这是诊断开关，不改变产品可见性 / DWM / focus，也不是为讨好测量改行为。

#![cfg(windows)]

use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_2, ICoreWebView2_20, ICoreWebView2Environment13, ICoreWebView2FrameInfo,
    ICoreWebView2FrameInfo2, ICoreWebView2FrameInfoCollection, ICoreWebView2ProcessExtendedInfo,
    ICoreWebView2ProcessExtendedInfoCollection, COREWEBVIEW2_FRAME_KIND,
    COREWEBVIEW2_FRAME_KIND_EMBED, COREWEBVIEW2_FRAME_KIND_IFRAME,
    COREWEBVIEW2_FRAME_KIND_MAIN_FRAME, COREWEBVIEW2_FRAME_KIND_OBJECT,
    COREWEBVIEW2_FRAME_KIND_UNKNOWN, COREWEBVIEW2_PROCESS_KIND,
    COREWEBVIEW2_PROCESS_KIND_BROWSER, COREWEBVIEW2_PROCESS_KIND_GPU,
    COREWEBVIEW2_PROCESS_KIND_PPAPI_BROKER, COREWEBVIEW2_PROCESS_KIND_PPAPI_PLUGIN,
    COREWEBVIEW2_PROCESS_KIND_RENDERER, COREWEBVIEW2_PROCESS_KIND_SANDBOX_HELPER,
    COREWEBVIEW2_PROCESS_KIND_UTILITY,
};
use webview2_com::{take_pwstr, GetProcessExtendedInfosCompletedHandler};
use windows::core::{Interface, BOOL as CoreBool, PWSTR};
use windows::Win32::Foundation::HWND;
use windows_sys::Win32::Foundation::{CloseHandle, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, IsWindowVisible, RegisterClassW, HWND_MESSAGE, WM_COPYDATA,
    WM_DESTROY, WNDCLASSW, WS_OVERLAPPED,
};

pub const CLASS_NAME: &str = "TagLauncherIdleDiag";
pub const TITLE: &str = "TagLauncher IdleDiag";
/// COPYDATASTRUCT.dwData 魔数 'TLID'（窗口仅在显式开关打开时存在）
pub const COPYDATA_MAGIC: usize = 0x544C4944;
const ENV_ENABLE: &str = "TL_IDLE_DIAG";
const ENV_DIR: &str = "TL_IDLE_DIAG_DIR";
const MAX_COPYDATA: usize = 512;
const KEEP_SNAPSHOTS: usize = 4;

static APP: OnceLock<AppHandle> = OnceLock::new();
static HWND_ATOMIC: AtomicIsize = AtomicIsize::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static INFLIGHT: AtomicBool = AtomicBool::new(false);
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn diag_enabled() -> bool {
    matches!(std::env::var(ENV_ENABLE), Ok(v) if v == "1")
}

fn diag_dir() -> Option<PathBuf> {
    let raw = std::env::var(ENV_DIR).ok()?;
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return None;
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    Some(p)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn process_creation_ms(pid: u32) -> Option<u64> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut created = std::mem::zeroed();
        let mut exit = std::mem::zeroed();
        let mut kernel = std::mem::zeroed();
        let mut user = std::mem::zeroed();
        let ok = GetProcessTimes(h, &mut created, &mut exit, &mut kernel, &mut user);
        CloseHandle(h);
        if ok == 0 {
            return None;
        }
        let ticks =
            ((created.dwHighDateTime as u64) << 32) | (created.dwLowDateTime as u64);
        // FILETIME：1601-01-01 起的 100ns
        Some(ticks / 10_000 - 11_644_473_600_000)
    }
}

fn process_kind_name(k: COREWEBVIEW2_PROCESS_KIND) -> String {
    match k {
        COREWEBVIEW2_PROCESS_KIND_BROWSER => "Browser".into(),
        COREWEBVIEW2_PROCESS_KIND_RENDERER => "Renderer".into(),
        COREWEBVIEW2_PROCESS_KIND_UTILITY => "Utility".into(),
        COREWEBVIEW2_PROCESS_KIND_SANDBOX_HELPER => "SandboxHelper".into(),
        COREWEBVIEW2_PROCESS_KIND_GPU => "Gpu".into(),
        COREWEBVIEW2_PROCESS_KIND_PPAPI_PLUGIN => "PpapiPlugin".into(),
        COREWEBVIEW2_PROCESS_KIND_PPAPI_BROKER => "PpapiBroker".into(),
        other => format!("unknown({})", other.0),
    }
}

fn frame_kind_name(k: COREWEBVIEW2_FRAME_KIND) -> String {
    match k {
        COREWEBVIEW2_FRAME_KIND_UNKNOWN => "Unknown".into(),
        COREWEBVIEW2_FRAME_KIND_MAIN_FRAME => "Main".into(),
        COREWEBVIEW2_FRAME_KIND_IFRAME => "Iframe".into(),
        COREWEBVIEW2_FRAME_KIND_EMBED => "Embed".into(),
        COREWEBVIEW2_FRAME_KIND_OBJECT => "Object".into(),
        other => format!("unknown({})", other.0),
    }
}

fn pwstr_of<F>(f: F) -> Option<String>
where
    F: FnOnce(*mut PWSTR) -> windows::core::Result<()>,
{
    let mut p = PWSTR::null();
    match f(&mut p) {
        Ok(()) => Some(take_pwstr(p)),
        Err(_) => None,
    }
}

fn read_u32<F>(f: F) -> Option<u32>
where
    F: FnOnce(*mut u32) -> windows::core::Result<()>,
{
    let mut v = 0u32;
    f(&mut v).ok().map(|_| v)
}

fn read_i32<F>(f: F) -> Option<i32>
where
    F: FnOnce(*mut i32) -> windows::core::Result<()>,
{
    let mut v = 0i32;
    f(&mut v).ok().map(|_| v)
}

fn collect_associated_frames(fc: &ICoreWebView2FrameInfoCollection) -> Vec<Value> {
    // FrameInfoCollection 只有 GetIterator，没有 Count/GetValueAtIndex。
    let iter = match unsafe { fc.GetIterator() } {
        Ok(it) => it,
        Err(e) => {
            return vec![json!({
                "frame_id_status": "UNKNOWN",
                "reason": format!("GetIterator failed: {e}"),
            })];
        }
    };
    let mut frames = Vec::new();
    loop {
        let mut has = CoreBool::default();
        if unsafe { iter.HasCurrent(&mut has) }.is_err() || !has.as_bool() {
            break;
        }
        if let Ok(fi) = unsafe { iter.GetCurrent() } {
            frames.push(collect_frame_info(&fi));
        }
        let mut moved = CoreBool::default();
        if unsafe { iter.MoveNext(&mut moved) }.is_err() || !moved.as_bool() {
            break;
        }
    }
    frames
}

fn snapshot_path(dir: &Path, generation: u64) -> PathBuf {
    dir.join(format!(
        "TagLauncher-idle-diag-{}-{}.json",
        std::process::id(),
        generation
    ))
}

fn cleanup_snapshots(dir: &Path, pid: u32, keep: usize) {
    let prefix = format!("TagLauncher-idle-diag-{pid}-");
    let mut files: Vec<(u64, PathBuf)> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with(&prefix) || !name.ends_with(".json") {
                return None;
            }
            let gen = name
                .trim_start_matches(&prefix)
                .trim_end_matches(".json")
                .parse::<u64>()
                .ok()?;
            Some((gen, e.path()))
        })
        .collect();
    files.sort_by_key(|(g, _)| *g);
    let drop_n = files.len().saturating_sub(keep);
    for (_, path) in files.into_iter().take(drop_n) {
        let _ = std::fs::remove_file(path);
    }
}

fn end_inflight() {
    INFLIGHT.store(false, Ordering::SeqCst);
}

fn write_snapshot(generation: u64, value: Value) {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(dir) = diag_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let path = snapshot_path(&dir, generation);
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(&value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
        cleanup_snapshots(&dir, std::process::id(), KEEP_SNAPSHOTS);
    }
    end_inflight();
}

fn parse_tag(lparam: LPARAM) -> String {
    if lparam == 0 {
        return String::new();
    }
    let cds = unsafe { &*(lparam as *const COPYDATASTRUCT) };
    if cds.lpData.is_null() || cds.cbData == 0 {
        return String::new();
    }
    let n = (cds.cbData as usize).min(MAX_COPYDATA);
    let bytes = unsafe { std::slice::from_raw_parts(cds.lpData as *const u8, n) };
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        v.get("tag")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        text
    }
}

#[derive(Clone)]
struct ControllerSnap {
    label: String,
    hwnd: Option<isize>,
    hwnd_visible: Option<bool>,
    parent_window: Option<isize>,
    controller_is_visible: Option<bool>,
    source: Option<String>,
    browser_process_id: Option<u32>,
    frame_id: Option<u32>,
    frame_id_status: String,
    env13_ready: bool,
    env13_error: Option<String>,
}

fn collect_controllers(app: &AppHandle) -> Vec<ControllerSnap> {
    let mut out = Vec::new();
    for (label, window) in app.webview_windows() {
        let hwnd = window.hwnd().ok().map(|h| h.0 as isize);
        let hwnd_visible = hwnd.map(|h| unsafe { IsWindowVisible(h as _) != 0 });
        let mut snap = ControllerSnap {
            label,
            hwnd,
            hwnd_visible,
            parent_window: None,
            controller_is_visible: None,
            source: None,
            browser_process_id: None,
            frame_id: None,
            frame_id_status: "UNKNOWN".into(),
            env13_ready: false,
            env13_error: None,
        };
        let slot = std::sync::Arc::new(Mutex::new(None::<ControllerSnap>));
        let to_fill = slot.clone();
        let seed = ControllerSnap {
            label: snap.label.clone(),
            hwnd: snap.hwnd,
            hwnd_visible: snap.hwnd_visible,
            parent_window: None,
            controller_is_visible: None,
            source: None,
            browser_process_id: None,
            frame_id: None,
            frame_id_status: "UNKNOWN".into(),
            env13_ready: false,
            env13_error: None,
        };
        let _ = window.with_webview(move |webview| {
            let mut cur = seed;
            // SAFETY：with_webview 在 UI/WebView 线程执行；只读，不 SetIsVisible / 不 eval。
            unsafe {
                let controller = webview.controller();
                let mut parent = HWND::default();
                if controller.ParentWindow(&mut parent).is_ok() {
                    cur.parent_window = Some(parent.0 as isize);
                }
                let mut vis = CoreBool::default();
                if controller.IsVisible(&mut vis).is_ok() {
                    cur.controller_is_visible = Some(vis.as_bool());
                }
                match controller.CoreWebView2() {
                    Ok(core) => {
                        cur.source = pwstr_of(|p| core.Source(p));
                        cur.browser_process_id = read_u32(|p| core.BrowserProcessId(p));
                        match core.cast::<ICoreWebView2_20>() {
                            Ok(core20) => match read_u32(|p| core20.FrameId(p)) {
                                Some(0) | None => {
                                    cur.frame_id = Some(0);
                                    cur.frame_id_status = "UNKNOWN".into();
                                }
                                Some(id) => {
                                    cur.frame_id = Some(id);
                                    cur.frame_id_status = "ok".into();
                                }
                            },
                            Err(e) => {
                                cur.frame_id_status =
                                    format!("UNKNOWN: interface-missing ICoreWebView2_20 ({e})");
                            }
                        }
                        // Environment 在 ICoreWebView2_2；与 FrameId（_20）分开查询，缺 _20 仍可采进程表。
                        match core.cast::<ICoreWebView2_2>().and_then(|c2| c2.Environment()) {
                            Ok(env) => match env.cast::<ICoreWebView2Environment13>() {
                                Ok(_env13) => {
                                    cur.env13_ready = true;
                                }
                                Err(e) => {
                                    cur.env13_error = Some(format!(
                                        "interface-missing ICoreWebView2Environment13 ({e})"
                                    ));
                                }
                            },
                            Err(e) => {
                                cur.env13_error = Some(format!("Environment() failed ({e})"));
                            }
                        }
                    }
                    Err(e) => {
                        cur.frame_id_status = format!("UNKNOWN: CoreWebView2 unavailable ({e})");
                    }
                }
            }
            if let Ok(mut g) = to_fill.lock() {
                *g = Some(cur);
            }
        });
        if let Ok(mut g) = slot.lock() {
            if let Some(filled) = g.take() {
                snap = filled;
            }
        }
        out.push(snap);
    }
    out
}

fn collect_frame_info(info: &ICoreWebView2FrameInfo) -> Value {
    let source = pwstr_of(|p| unsafe { info.Source(p) });
    let name = pwstr_of(|p| unsafe { info.Name(p) });
    let mut frame_id: Option<u32> = None;
    let mut frame_id_status = "UNKNOWN: interface-missing ICoreWebView2FrameInfo2".to_string();
    let mut frame_kind = Value::Null;
    let mut parent = Value::Null;
    match info.cast::<ICoreWebView2FrameInfo2>() {
        Ok(info2) => {
            match read_u32(|p| unsafe { info2.FrameId(p) }) {
                Some(0) | None => {
                    frame_id = Some(0);
                    frame_id_status = "UNKNOWN: frame-id-zero-or-unreadable".into();
                }
                Some(id) => {
                    frame_id = Some(id);
                    frame_id_status = "ok".into();
                }
            }
            let mut kind = COREWEBVIEW2_FRAME_KIND::default();
            if unsafe { info2.FrameKind(&mut kind) }.is_ok() {
                frame_kind = json!(frame_kind_name(kind));
            }
            match unsafe { info2.ParentFrameInfo() } {
                Ok(p) => {
                    let parent_id = match p.cast::<ICoreWebView2FrameInfo2>() {
                        Ok(p2) => match read_u32(|q| unsafe { p2.FrameId(q) }) {
                            Some(0) | None => json!("UNKNOWN"),
                            Some(id) => json!(id),
                        },
                        Err(_) => json!("UNKNOWN"),
                    };
                    parent = json!({
                        "frame_id": parent_id,
                        "source": pwstr_of(|q| unsafe { p.Source(q) }),
                        "name": pwstr_of(|q| unsafe { p.Name(q) }),
                    });
                }
                Err(_) => parent = Value::Null,
            }
        }
        Err(_) => {}
    }
    json!({
        "frame_id": frame_id,
        "frame_id_status": frame_id_status,
        "source": source,
        "name": name,
        "frame_kind": frame_kind,
        "parent_frame_info": parent,
    })
}

fn collect_extended_infos(
    col: &ICoreWebView2ProcessExtendedInfoCollection,
) -> Result<Vec<Value>, String> {
    let mut n = 0u32;
    unsafe { col.Count(&mut n) }.map_err(|e| format!("Count failed: {e}"))?;
    let mut processes = Vec::new();
    for i in 0..n {
        let ext: ICoreWebView2ProcessExtendedInfo = match unsafe { col.GetValueAtIndex(i) } {
            Ok(v) => v,
            Err(e) => {
                processes.push(json!({
                    "status": "UNKNOWN",
                    "reason": format!("GetValueAtIndex({i}) failed: {e}"),
                }));
                continue;
            }
        };
        let (pid, kind_name) = match unsafe { ext.ProcessInfo() } {
            Ok(info) => {
                // ICoreWebView2ProcessInfo::ProcessId 是 *mut i32，不是 u32。
                let pid = read_i32(|p| unsafe { info.ProcessId(p) }).map(|v| v as u32);
                let mut kind = COREWEBVIEW2_PROCESS_KIND::default();
                let kn = if unsafe { info.Kind(&mut kind) }.is_ok() {
                    process_kind_name(kind)
                } else {
                    "UNKNOWN".into()
                };
                (pid, kn)
            }
            Err(e) => {
                processes.push(json!({
                    "status": "UNKNOWN",
                    "reason": format!("ProcessInfo failed: {e}"),
                }));
                continue;
            }
        };
        let mut frames = Vec::new();
        match unsafe { ext.AssociatedFrameInfos() } {
            Ok(fc) => frames.extend(collect_associated_frames(&fc)),
            Err(e) => frames.push(json!({
                "frame_id_status": "UNKNOWN",
                "reason": format!("AssociatedFrameInfos failed: {e}"),
            })),
        }
        let pid_v = pid.unwrap_or(0);
        processes.push(json!({
            "pid": pid,
            "kind": kind_name,
            "creation_time_ms": process_creation_ms(pid_v),
            "frames": frames,
        }));
    }
    Ok(processes)
}

fn join_frame_id(frame_id: Option<u32>, status: &str, processes: &[Value]) -> Value {
    if status != "ok" {
        return json!({
            "status": "UNKNOWN",
            "reason": status,
        });
    }
    let Some(fid) = frame_id.filter(|id| *id != 0) else {
        return json!({
            "status": "UNKNOWN",
            "reason": "frame-id-zero",
        });
    };
    let mut hits: Vec<Value> = Vec::new();
    for proc in processes {
        let frames = proc.get("frames").and_then(|x| x.as_array());
        let Some(frames) = frames else { continue };
        for fr in frames {
            let ok = fr.get("frame_id_status").and_then(|x| x.as_str()) == Some("ok");
            let id = fr.get("frame_id").and_then(|x| x.as_u64());
            if ok && id == Some(fid as u64) {
                hits.push(json!({
                    "pid": proc.get("pid"),
                    "kind": proc.get("kind"),
                    "creation_time_ms": proc.get("creation_time_ms"),
                    "frame": fr,
                }));
            }
        }
    }
    match hits.len() {
        0 => json!({
            "status": "UNKNOWN",
            "reason": "snapshot-unsync: no FrameInfo2 with this FrameId (navigation/destroy race; not guessed by URL or order)",
            "frame_id": fid,
        }),
        1 => json!({
            "status": "ok",
            "frame_id": fid,
            "process": hits.remove(0),
        }),
        _ => json!({
            "status": "ok",
            "note": "multiple FrameInfo entries share this FrameId (unexpected); not guessed, all listed",
            "frame_id": fid,
            "processes": hits,
        }),
    }
}

fn finish_snapshot(
    generation: u64,
    tag: String,
    start_ms: u64,
    controllers: Vec<ControllerSnap>,
    processes: Result<Vec<Value>, String>,
    processes_status: &str,
    processes_reason: Option<String>,
) {
    let (procs, pstatus, preason) = match processes {
        Ok(v) => (v, processes_status.to_string(), processes_reason),
        Err(e) => (Vec::new(), "UNKNOWN".into(), Some(e)),
    };
    let windows: Vec<Value> = controllers
        .iter()
        .map(|c| {
            let mapping = if pstatus == "ok" {
                join_frame_id(c.frame_id, &c.frame_id_status, &procs)
            } else {
                json!({
                    "status": "UNKNOWN",
                    "reason": preason.clone().unwrap_or_else(|| pstatus.clone()),
                })
            };
            json!({
                "label": c.label,
                "hwnd": c.hwnd,
                "hwnd_visible": c.hwnd_visible,
                "controller_parent_window": c.parent_window,
                "controller_is_visible": c.controller_is_visible,
                "source": c.source,
                "browser_process_id": c.browser_process_id,
                "browser_process_creation_time_ms": c.browser_process_id.and_then(process_creation_ms),
                "frame_id": c.frame_id,
                "frame_id_status": c.frame_id_status,
                "mapping": mapping,
            })
        })
        .collect();
    let host = std::process::id();
    write_snapshot(
        generation,
        json!({
            "ok": pstatus == "ok",
            "generation": generation,
            "tag": tag,
            "snapshot_start_ms": start_ms,
            "snapshot_end_ms": now_ms(),
            "host_pid": host,
            "host_creation_time_ms": process_creation_ms(host),
            "processes_status": pstatus,
            "processes_reason": preason,
            "windows": windows,
            "processes": procs,
            "notes": [
                "join is ICoreWebView2_20.FrameId ↔ FrameInfo2.FrameId only; never by URL or creation order",
                "one renderer may own many frames/windows",
                "interface missing / FrameId 0 / snapshot unsync => UNKNOWN",
                "read-only: no JS, no focus/visibility/DWM change, no periodic poll",
            ],
        }),
    );
}

fn start_snapshot(tag: String) -> u64 {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let start_ms = now_ms();
    let Some(app) = APP.get() else {
        write_snapshot(
            generation,
            json!({
                "ok": false,
                "generation": generation,
                "tag": tag,
                "snapshot_start_ms": start_ms,
                "snapshot_end_ms": now_ms(),
                "error": "idle_diag AppHandle not installed",
            }),
        );
        return generation;
    };
    let controllers = collect_controllers(app);
    let env13_error = controllers
        .iter()
        .find_map(|c| c.env13_error.clone());
    if !controllers.iter().any(|c| c.env13_ready) {
        let reason = env13_error.unwrap_or_else(|| {
            "interface-missing ICoreWebView2Environment13 or no WebView yet".into()
        });
        finish_snapshot(
            generation,
            tag,
            start_ms,
            controllers,
            Err(reason.clone()),
            "UNKNOWN",
            Some(reason),
        );
        return generation;
    }
    // COM 指针不是 Send，不能经 with_webview 闭包运出。在 UI 线程闭包内启动异步查询。
    let label = controllers
        .iter()
        .find(|c| c.env13_ready)
        .map(|c| c.label.clone())
        .expect("env13_ready");
    let Some(window) = app.get_webview_window(&label) else {
        finish_snapshot(
            generation,
            tag,
            start_ms,
            controllers,
            Err("webview window disappeared before GetProcessExtendedInfos".into()),
            "UNKNOWN",
            Some("webview window disappeared before GetProcessExtendedInfos".into()),
        );
        return generation;
    }
    let snaps_handler = controllers.clone();
    let snaps_err = controllers;
    let tag_handler = tag.clone();
    let tag_err = tag.clone();
    let tag_queue_err = tag;
    let snaps_queue_err = snaps_err.clone();
    let start = window.with_webview(move |webview| {
        let env13 = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .ok()
                .and_then(|core| core.cast::<ICoreWebView2_2>().ok())
                .and_then(|c2| c2.Environment().ok())
                .and_then(|env| env.cast::<ICoreWebView2Environment13>().ok())
        };
        let Some(env13) = env13 else {
            finish_snapshot(
                generation,
                tag_err,
                start_ms,
                snaps_err,
                Err("Environment13 unavailable when starting GetProcessExtendedInfos".into()),
                "UNKNOWN",
                Some("Environment13 unavailable when starting GetProcessExtendedInfos".into()),
            );
            return;
        };
        let handler = GetProcessExtendedInfosCompletedHandler::create(Box::new(move |hr, collection| {
            // create() 要 CompletedClosure = Box<dyn FnOnce(Result<()>, Option<Collection>)>.
            let outcome = match hr {
                Ok(()) => match collection {
                    Some(col) => collect_extended_infos(&col),
                    None => Err("GetProcessExtendedInfos completed with empty collection".into()),
                },
                Err(e) => Err(format!("GetProcessExtendedInfos failed: {e}")),
            };
            let pstatus = if outcome.as_ref().ok().is_some() {
                "ok"
            } else {
                "UNKNOWN"
            };
            let preason = outcome.as_ref().err().cloned();
            finish_snapshot(
                generation,
                tag_handler,
                start_ms,
                snaps_handler,
                outcome,
                pstatus,
                preason,
            );
            Ok(())
        }));
        if let Err(e) = unsafe { env13.GetProcessExtendedInfos(&handler) } {
            finish_snapshot(
                generation,
                tag_err.clone(),
                start_ms,
                snaps_err,
                Err(format!("GetProcessExtendedInfos start failed: {e}")),
                "UNKNOWN",
                Some(format!("GetProcessExtendedInfos start failed: {e}")),
            );
        }
    });
    if let Err(e) = start {
        finish_snapshot(
            generation,
            tag_queue_err,
            start_ms,
            snaps_queue_err,
            Err(format!("with_webview failed: {e}")),
            "UNKNOWN",
            Some(format!("with_webview failed: {e}")),
        );
    }
    generation
}

unsafe extern "system" fn wnd_proc(hwnd: windows_sys::Win32::Foundation::HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_COPYDATA => {
            if !diag_enabled() {
                return 0;
            }
            let cds_ok = if lparam == 0 {
                false
            } else {
                let cds = &*(lparam as *const COPYDATASTRUCT);
                cds.dwData == COPYDATA_MAGIC && (cds.cbData as usize) <= MAX_COPYDATA
            };
            if !cds_ok {
                return 0;
            }
            if INFLIGHT
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return 0; // 单 inflight：拒绝重叠请求
            }
            let tag = parse_tag(lparam);
            // 立即排队异步 COM，立刻返回 generation；不在 UI 线程等待完成。
            start_snapshot(tag) as LRESULT
        }
        WM_DESTROY => 0,
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// 在 UI 线程安装 message-only 隐藏窗口。不显示、不抢焦点、不改既有窗口。
/// 默认不安装；仅 TL_IDLE_DIAG=1 且目录合法时启用。
pub fn install(app: AppHandle) {
    if !diag_enabled() {
        log::info!("[idle_diag] disabled (TL_IDLE_DIAG!=1); window not installed");
        return;
    }
    if diag_dir().is_none() {
        log::warn!("[idle_diag] TL_IDLE_DIAG_DIR missing or unsafe; window not installed");
        return;
    }
    let _ = APP.set(app);
    if HWND_ATOMIC.load(Ordering::SeqCst) != 0 {
        return;
    }
    let class = wide(CLASS_NAME);
    let title = wide(TITLE);
    unsafe {
        let hinst = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinst,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class.as_ptr(),
        };
        RegisterClassW(&wc);
        let h = CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            hinst,
            std::ptr::null(),
        );
        if h.is_null() {
            log::warn!("[idle_diag] 创建隐藏诊断窗口失败");
            return;
        }
        HWND_ATOMIC.store(h as isize, Ordering::SeqCst);
        log::info!("[idle_diag] 隐藏诊断窗口已安装 hwnd={:?}", h);
    }
}
