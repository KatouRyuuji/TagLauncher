//! 一次真实点击的收纳交付记录：只写经过校验的请求 id、盐化路径哈希、PID、完整性 RID、
//! 版本标识、HWND、transport_ack 与 merge receipt。不写用户路径原文，不在热路径读整份 exe。
//!
//! 日志目录用 SHGetKnownFolderPath(FOLDERID_LocalAppData)\TagLauncher，
//! 与 DLL 的 AppendStatus 相同，不用进程环境里的 LOCALAPPDATA（沙箱可能不同）。
//! `transport_ack` 是窗口过程返回 1（插件 2.5.3 在 dwData 不匹配时也会返回 1）。
//! `merge_committed` 只来自本次 CollectState::merge 的 receipt，不能用 transport_ack 冒充。

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::collect::MergeReceipt;

pub const MENU_REQ_ARG: &str = "--tl-menu-req";
const LOG_NAME: &str = "win11-menu-delivery.jsonl";
const LOG_MAX: u64 = 256 * 1024;
const LOG_KEEP: u64 = 64 * 1024;
const INVALID_REQ: &str = "invalid_req";

/// 产品 nonce：正常 32 位 hex，GUID 失败时的 fallback 16 位 hex。其它值一律视为非法，不回显。
pub fn is_valid_nonce(s: &str) -> bool {
    (s.len() == 16 || s.len() == 32) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn sanitize_req(raw: Option<&str>) -> Option<String> {
    let s = raw?;
    if is_valid_nonce(s) {
        Some(s.to_ascii_lowercase())
    } else {
        Some(INVALID_REQ.to_string())
    }
}

/// 取 `--tl-menu-req` 的下一个参数并校验。必须出现在 `--collect` 之前。
/// 合法则返回规范化 hex；有 flag 但非法则返回 `invalid_req`；没有 flag 返回 None。绝不回显任意原文。
pub fn request_id_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a.as_ref() == crate::collect::COLLECT_ARG {
            return None;
        }
        if a.as_ref() == MENU_REQ_ARG {
            return sanitize_req(it.next().as_ref().map(|s| s.as_ref()));
        }
    }
    None
}

/// 与 collect::path_key 相同的规范化后再加盐（已校验的请求 id），只输出 SHA-256 十六进制。
pub fn salted_path_hash(req: &str, path: &str) -> String {
    let key = crate::collect::path_key(path);
    hex(&sha256(format!("{req}:{key}").as_bytes()))
}

fn exe_identity(req: Option<&str>, path: Option<&Path>) -> (Option<String>, &'static str) {
    let salt = req.as_deref().unwrap_or("none");
    let hash = path.and_then(|p| p.to_str()).map(|s| salted_path_hash(salt, s));
    (hash, env!("CARGO_PKG_VERSION"))
}

pub fn record(fields: &serde_json::Value) {
    match write_line(fields) {
        Ok(()) => {}
        Err(e) => {
            log::warn!(
                "[menu_delivery] write failed kind={:?} os={:?}",
                e.kind(),
                e.raw_os_error()
            );
        }
    }
}

fn write_line(fields: &serde_json::Value) -> std::io::Result<()> {
    let dir = known_taglauncher_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "known_folder_missing")
    })?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(LOG_NAME);
    let mut f = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)?;
    let _lock = lock_exclusive(&f)?;
    trim_to_keep(&mut f)?;
    f.seek(SeekFrom::End(0))?;
    f.write_all(fields.to_string().as_bytes())?;
    f.write_all(b"\n")?;
    f.flush()?;
    // 持锁再检查，避免并发追加把文件顶过上限后无人截断。
    trim_to_keep(&mut f)?;
    Ok(())
}

fn trim_to_keep(f: &mut std::fs::File) -> std::io::Result<()> {
    let len = f.metadata()?.len();
    if len <= LOG_MAX {
        return Ok(());
    }
    f.seek(SeekFrom::Start(len.saturating_sub(LOG_KEEP)))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    if let Some(i) = buf.iter().position(|&b| b == b'\n') {
        buf = buf[i + 1..].to_vec();
    }
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(&buf)?;
    f.flush()?;
    Ok(())
}

/// 进程间互斥截断/追加。只保存 HANDLE，不借用 File，以便持锁期间对同一文件做 &mut 读写。
/// 失败只返回错误码，不 panic、不把路径写进错误信息。
fn lock_exclusive(f: &std::fs::File) -> std::io::Result<FileLock> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::LockFile;
        let h = f.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        let ok = unsafe { LockFile(h, 0, 0, u32::MAX, u32::MAX) };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(FileLock { handle: h })
    }
    #[cfg(not(windows))]
    {
        let _ = f;
        Ok(FileLock {})
    }
}

struct FileLock {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

impl Drop for FileLock {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Storage::FileSystem::UnlockFile;
            unsafe {
                UnlockFile(self.handle, 0, 0, u32::MAX, u32::MAX);
            }
        }
    }
}

pub fn record_child_start(args: &[String]) {
    let req = request_id_from_args(args);
    let exe = std::env::current_exe().ok();
    let (path_hash, version) = exe_identity(req.as_deref(), exe.as_deref());
    record(&serde_json::json!({
        "event": "child_start",
        "req": req,
        "child_pid": std::process::id(),
        "il": current_integrity_rid(),
        "session": current_session_id(),
        "exe_path_hash": path_hash,
        "exe_version": version,
    }));
}

/// 用本次 merge 的 receipt 记账，不用事后另一份 snapshot，也不用 transport_ack 冒充。
pub fn record_merge(req: Option<&str>, receipt: &MergeReceipt) {
    let event = if receipt.merge_committed {
        "merge_committed"
    } else if receipt.pending {
        "merge_pending"
    } else if receipt.error.is_some() {
        "merge_rejected"
    } else {
        "submit_skipped"
    };
    record(&serde_json::json!({
        "event": event,
        "req": req,
        "merge_committed": receipt.merge_committed,
        "pending": receipt.pending,
        "receiver_pid": std::process::id(),
        "il": current_integrity_rid(),
        "session": current_session_id(),
        "session_id": receipt.session_id,
        "path_count": receipt.path_count,
        "invalid": receipt.invalid,
        "arrival": receipt.arrival,
        "error": receipt.error,
    }));
}

pub fn record_forward_attempt(
    req: Option<&str>,
    hwnd: usize,
    receiver_pid: u32,
    receiver_il: Option<u32>,
    receiver_path_hash: Option<&str>,
    sent: usize,
    result: usize,
    last_error: u32,
    transport_ack: bool,
) {
    record(&serde_json::json!({
        "event": "transport_ack",
        "req": req,
        "child_pid": std::process::id(),
        "child_il": current_integrity_rid(),
        "hwnd": format!("0x{hwnd:X}"),
        "receiver_pid": receiver_pid,
        "receiver_il": receiver_il,
        "receiver_path_hash": receiver_path_hash,
        "receiver_version": env!("CARGO_PKG_VERSION"),
        "sent": sent,
        "result": result,
        "last_error": last_error,
        "transport_ack": transport_ack,
    }));
}

fn known_taglauncher_dir() -> Option<PathBuf> {
    known_local_appdata().map(|p| p.join("TagLauncher"))
}

fn current_integrity_rid() -> Option<u32> {
    integrity_rid(std::process::id())
}

fn current_session_id() -> Option<u32> {
    session_id(std::process::id())
}

#[cfg(windows)]
fn known_local_appdata() -> Option<PathBuf> {
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_LocalAppData};
    unsafe {
        let mut ptr = std::ptr::null_mut();
        let hr = SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, std::ptr::null_mut(), &mut ptr);
        if hr < 0 || ptr.is_null() {
            return None;
        }
        let mut n = 0usize;
        while *ptr.add(n) != 0 {
            n += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, n));
        CoTaskMemFree(ptr.cast());
        Some(PathBuf::from(s))
    }
}

#[cfg(not(windows))]
fn known_local_appdata() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
pub fn integrity_rid(pid: u32) -> Option<u32> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
        TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if proc.is_null() {
            return None;
        }
        let mut tok = std::ptr::null_mut();
        if OpenProcessToken(proc, TOKEN_QUERY, &mut tok) == 0 {
            CloseHandle(proc);
            return None;
        }
        let mut n = 0u32;
        GetTokenInformation(tok, TokenIntegrityLevel, std::ptr::null_mut(), 0, &mut n);
        if n == 0 {
            CloseHandle(tok);
            CloseHandle(proc);
            return None;
        }
        let words = (n as usize + 7) / 8;
        let mut buf = vec![0u64; words];
        let ok = GetTokenInformation(tok, TokenIntegrityLevel, buf.as_mut_ptr().cast(), n, &mut n);
        CloseHandle(tok);
        CloseHandle(proc);
        if ok == 0 || (n as usize) < std::mem::size_of::<TOKEN_MANDATORY_LABEL>() {
            return None;
        }
        let til = buf.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
        let sid = (*til).Label.Sid;
        if sid.is_null() {
            return None;
        }
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 {
            return None;
        }
        Some(*GetSidSubAuthority(sid, (count - 1) as u32))
    }
}

#[cfg(not(windows))]
pub fn integrity_rid(_pid: u32) -> Option<u32> {
    None
}

/// 只取镜像路径再做盐化哈希，不把整份 exe 读进热路径。
#[cfg(windows)]
pub fn process_exe_path_hash(pid: u32, req: Option<&str>) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if proc.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(proc, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(proc);
        if ok == 0 || len == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let salt = req.unwrap_or("none");
        Some(salted_path_hash(salt, &path))
    }
}

#[cfg(not(windows))]
pub fn process_exe_path_hash(_pid: u32, _req: Option<&str>) -> Option<String> {
    None
}

#[cfg(windows)]
fn session_id(pid: u32) -> Option<u32> {
    // windows-sys 0.59.0 将此符号放在 Win32::System::RemoteDesktop，不在 Threading。
    // 声明：kernel32.dll "system" fn(u32, *mut u32) -> BOOL（BOOL = i32）。
    use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    let mut s = 0u32;
    unsafe {
        if ProcessIdToSessionId(pid, &mut s) != 0 {
            Some(s)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
fn session_id(_pid: u32) -> Option<u32> {
    None
}

fn hex(bytes: &[u8]) -> String {
    const T: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(T[(b >> 4) as usize] as char);
        out.push(T[(b & 0xf) as usize] as char);
    }
    out
}

fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_id_stops_at_collect_so_paths_are_untouched() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(
            request_id_from_args(s(&["--tl-menu-req", "abc123abc123abcd", "--collect", "D:\\a.txt"])),
            Some("abc123abc123abcd".into())
        );
        assert_eq!(
            request_id_from_args(s(&["--collect", "--tl-menu-req", "abc123abc123abcd"])),
            None
        );
        assert_eq!(request_id_from_args(s(&["--show", "--collect"])), None);
        assert_eq!(
            crate::collect::collect_args(s(&[
                "--tl-menu-req",
                "abc123abc123abcd",
                "--collect",
                "D:\\a.txt"
            ])),
            Some(vec!["D:\\a.txt".into()])
        );
    }

    #[test]
    fn nonce_rejects_arbitrary_values_without_echoing_them() {
        assert_eq!(sanitize_req(None), None);
        assert_eq!(sanitize_req(Some("0123456789abcdef")), Some("0123456789abcdef".into()));
        assert_eq!(
            sanitize_req(Some("0123456789ABCDEF0123456789ABCDEF")),
            Some("0123456789abcdef0123456789abcdef".into())
        );
        assert_eq!(sanitize_req(Some(r"C:\Users\me\probe.txt")), Some("invalid_req".into()));
        assert_eq!(sanitize_req(Some("xyz")), Some("invalid_req".into()));
        let leaked = request_id_from_args([
            "--tl-menu-req".to_string(),
            r"C:\Users\me\secret.txt".to_string(),
            "--collect".to_string(),
        ]);
        assert_eq!(leaked, Some("invalid_req".into()));
        assert!(!format!("{leaked:?}").to_lowercase().contains("users"));
        assert!(!format!("{leaked:?}").contains("secret"));
    }

    #[test]
    fn salted_hash_is_stable_and_omits_the_raw_path() {
        let h = salted_path_hash("req1req1req1req1", r"C:\Users\me\probe.txt");
        assert_eq!(h, salted_path_hash("req1req1req1req1", r"c:/users/me/probe.txt"));
        assert_ne!(h, salted_path_hash("req2req2req2req2", r"C:\Users\me\probe.txt"));
        assert_eq!(h.len(), 64);
        assert!(!h.contains("users"));
        assert!(!h.contains("probe"));
        // SHA-256("abc") well-known digest, guards the local implementation.
        assert_eq!(
            hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
