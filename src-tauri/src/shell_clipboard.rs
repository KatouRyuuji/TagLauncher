//! 应用内「复制文件」（CF_HDROP）与系统「打开方式…」对话框。
//!
//! CF_HDROP 的内存布局（DROPFILES 头 + 双零结尾的 UTF-16 路径表）由纯函数生成与解析，便于单测；
//! 真正读写剪贴板、弹对话框的部分只在 Windows 上编译。

use crate::db::Database;
use crate::services::item_service;
use tauri::State;

/// DROPFILES 头长度：pFiles(u32) + pt(i32,i32) + fNC(u32) + fWide(u32)
const DROPFILES_HEADER: usize = 20;

/// 生成 CF_HDROP 数据：DROPFILES 头（fWide=1）+ 每条路径 UTF-16 以 0 结尾 + 末尾再一个 0。
pub fn dropfiles_payload(paths: &[String]) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        DROPFILES_HEADER + paths.iter().map(|p| p.len() * 2 + 2).sum::<usize>() + 2,
    );
    out.extend_from_slice(&(DROPFILES_HEADER as u32).to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    for p in paths {
        for unit in p.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[cfg(test)]
/// 解析 CF_HDROP 数据（宽字符或 ANSI 按 Latin-1 兜底）。格式不对返回空表。
pub fn parse_dropfiles(bytes: &[u8]) -> Vec<String> {
    if bytes.len() < DROPFILES_HEADER {
        return Vec::new();
    }
    let word = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    let offset = word(0) as usize;
    let wide = word(16) != 0;
    if offset > bytes.len() {
        return Vec::new();
    }
    let body = &bytes[offset..];
    let mut out = Vec::new();
    if wide {
        let units: Vec<u16> = body
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        for part in units.split(|u| *u == 0) {
            if part.is_empty() {
                break;
            }
            out.push(String::from_utf16_lossy(part));
        }
    } else {
        for part in body.split(|b| *b == 0) {
            if part.is_empty() {
                break;
            }
            out.push(part.iter().map(|b| *b as char).collect());
        }
    }
    out
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;
    const DROPEFFECT_COPY: u32 = 1;

    /// 打开剪贴板：被别的程序占用时短暂重试
    fn open() -> Result<Clipboard, String> {
        for _ in 0..10 {
            // SAFETY：无窗口所有者打开剪贴板；成功后由 Clipboard 的 Drop 负责关闭
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Ok(Clipboard);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        Err("剪贴板被其他程序占用，请稍后再试".into())
    }

    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            // SAFETY：仅在 open() 成功后构造，配对关闭
            unsafe {
                CloseClipboard();
            }
        }
    }

    fn global_from(bytes: &[u8]) -> Result<HGLOBAL, String> {
        // SAFETY：分配可移动全局内存并拷入数据；交给 SetClipboardData 后所有权归系统
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
            if h.is_null() {
                return Err("分配剪贴板内存失败".into());
            }
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                GlobalFree(h);
                return Err("锁定剪贴板内存失败".into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            GlobalUnlock(h);
            Ok(h)
        }
    }

    fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
        let h = global_from(bytes)?;
        // SAFETY：剪贴板已打开；成功后内存归系统，失败时自行释放
        unsafe {
            if SetClipboardData(format, h as HANDLE).is_null() {
                GlobalFree(h);
                return Err("写入剪贴板失败".into());
            }
        }
        Ok(())
    }

    pub fn write_files(paths: &[String]) -> Result<(), String> {
        let _clip = open()?;
        // SAFETY：剪贴板已由本线程打开
        if unsafe { EmptyClipboard() } == 0 {
            return Err("清空剪贴板失败".into());
        }
        put(CF_HDROP, &super::dropfiles_payload(paths))?;
        // 告诉资源管理器这是「复制」而不是「剪切」
        let name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
        // SAFETY：以 0 结尾的 UTF-16 格式名
        let effect = unsafe { RegisterClipboardFormatW(name.as_ptr()) };
        if effect != 0 {
            put(effect, &DROPEFFECT_COPY.to_le_bytes())?;
        }
        // 纯文本同时放路径，粘到文本框里也有用
        let text: Vec<u16> = paths
            .join("\r\n")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let bytes: Vec<u8> = text.iter().flat_map(|u| u.to_le_bytes()).collect();
        put(CF_UNICODETEXT, &bytes)?;
        Ok(())
    }

    /// 系统「打开方式」对话框：在独立线程里弹出（模态阻塞），立即返回
    pub fn open_with(path: String) {
        let _ = std::thread::Builder::new()
            .name("tl-open-with".into())
            .spawn(move || {
                use windows_sys::Win32::System::Com::{
                    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
                };
                use windows_sys::Win32::UI::Shell::{
                    SHOpenWithDialog, OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OPENASINFO,
                };
                let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
                let info = OPENASINFO {
                    pcszFile: wide.as_ptr(),
                    pcszClass: std::ptr::null(),
                    oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_EXEC,
                };
                // SAFETY：本线程 STA 初始化后调用；info 与 wide 在调用期间有效
                unsafe {
                    let hr = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
                    let r = SHOpenWithDialog(std::ptr::null_mut(), &info);
                    if r < 0 {
                        log::warn!("[open-with] SHOpenWithDialog 失败：0x{:08x}", r as u32);
                    }
                    if hr >= 0 {
                        CoUninitialize();
                    }
                }
            });
    }
}

/// 解析对象当前路径（按文件ID重定位）；丢失的跳过
fn existing_paths(conn: &rusqlite::Connection, ids: &[i64]) -> (Vec<String>, usize) {
    let mut paths = Vec::new();
    let mut missing = 0;
    for id in ids {
        match item_service::resolve_current_path(conn, *id) {
            Ok(p) if std::path::Path::new(&p).exists() => paths.push(p),
            _ => missing += 1,
        }
    }
    (paths, missing)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFilesResult {
    pub copied: usize,
    pub missing: usize,
}

/// 「复制文件」：把对象以文件形式放进剪贴板，可直接粘贴到资源管理器或聊天软件
#[tauri::command(async)]
pub fn copy_items_as_files(db: State<Database>, ids: Vec<i64>) -> Result<CopyFilesResult, String> {
    let (paths, missing) = {
        let conn = db.get_conn();
        existing_paths(&conn, &ids)
    };
    if paths.is_empty() {
        return Err("所选对象的文件都不存在，无法复制".into());
    }
    #[cfg(windows)]
    win::write_files(&paths)?;
    Ok(CopyFilesResult {
        copied: paths.len(),
        missing,
    })
}

/// 系统「打开方式…」：只对存在的文件（文件夹没有打开方式）
#[tauri::command(async)]
pub fn open_with_dialog(db: State<Database>, id: i64) -> Result<(), String> {
    let path = {
        let conn = db.get_conn();
        item_service::resolve_current_path(&conn, id)?
    };
    if !std::path::Path::new(&path).is_file() {
        return Err("只有文件可以选择打开方式".into());
    }
    #[cfg(windows)]
    win::open_with(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropfiles_round_trips_unicode_paths() {
        let paths = vec![r"C:\资料\报告 v2.docx".to_string(), r"D:\a.txt".to_string()];
        let bytes = dropfiles_payload(&paths);
        assert_eq!(
            u32::from_le_bytes(bytes[0..4].try_into().unwrap()),
            20,
            "pFiles 指向头之后"
        );
        assert_eq!(
            u32::from_le_bytes(bytes[16..20].try_into().unwrap()),
            1,
            "fWide"
        );
        assert_eq!(
            &bytes[bytes.len() - 4..],
            &[0, 0, 0, 0],
            "最后一条路径的 0 + 表尾 0"
        );
        assert_eq!(parse_dropfiles(&bytes), paths);
    }

    #[test]
    fn parse_dropfiles_rejects_garbage_and_reads_ansi() {
        assert!(parse_dropfiles(&[1, 2, 3]).is_empty());
        let mut ansi = vec![20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        ansi.extend_from_slice(b"C:\\x.txt\0D:\\y\0\0");
        assert_eq!(
            parse_dropfiles(&ansi),
            vec!["C:\\x.txt".to_string(), "D:\\y".to_string()]
        );
        let mut bad_offset = dropfiles_payload(&["C:\\x".into()]);
        bad_offset[0] = 0xff;
        assert!(parse_dropfiles(&bad_offset).is_empty());
    }
}
