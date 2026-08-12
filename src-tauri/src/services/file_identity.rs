//! 对象身份：用 NTFS 卷序列号 + 文件ID 标识同一个文件/文件夹，
//! 使其在同一磁盘卷内重命名/移动后仍可被追踪并重定位到新路径。
//!
//! - 身份捕获 `get_identity`：纯标准库（`std::os::windows::fs::MetadataExt`），无 unsafe。
//! - 路径重定位 `resolve_path`：少量 Windows FFI（`OpenFileById` + `GetFinalPathNameByHandleW`），
//!   按文件ID O(1) 反查当前路径，无需扫盘；跨盘符/删除/离线时返回 None。

use std::io::{Read, Seek, SeekFrom};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetFileInformationByHandle, GetFinalPathNameByHandleW, GetLogicalDriveStringsW,
    OpenFileById, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_DESCRIPTOR,
    FILE_ID_DESCRIPTOR_0, FILE_LIST_DIRECTORY, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const SHARE_ALL: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;

/// 文件身份：卷序列号 + 文件索引（NTFS 上跨重命名/同盘移动稳定）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileIdentity {
    pub volume_serial: u32,
    pub file_id: u64,
}

impl FileIdentity {
    /// file_id 以十六进制字符串持久化（u64 可能超出 SQLite INTEGER 的 i64 正数范围）。
    pub fn file_id_hex(&self) -> String {
        format!("{:016x}", self.file_id)
    }

    /// 从持久化的十六进制字符串解析回 u64。
    pub fn parse_file_id_hex(s: &str) -> Option<u64> {
        u64::from_str_radix(s.trim(), 16).ok()
    }
}

/// 捕获给定路径的文件身份（FFI：CreateFileW + GetFileInformationByHandle）。
/// 文件/文件夹皆可。非 NTFS、网络盘、文件不存在或取值失败时返回 None，
/// 调用方据此回退到"按路径"处理。
pub fn get_identity(path: &str) -> Option<FileIdentity> {
    let handle = open_metadata_handle(path)?;
    let identity = identity_from_handle(handle);
    unsafe { CloseHandle(handle) };
    identity
}

/// 从已打开的句柄读取文件身份（卷序列号 + 64 位文件ID）。
///
/// 注意已知局限：64 位文件ID（MFT 记录号 + 16 位序列号）在文件存活期内唯一，
/// 但跨删除可被复用——NTFS 重用 MFT 记录时会递增高 16 位序列号以检测过期引用，
/// 故常规删除-新建会得到不同的 file_id；仅当序列号在 65536 次重用后回绕到同值这一
/// 极低概率边界，旧身份才可能误匹配到无关新文件。当前按可接受风险处理。
fn identity_from_handle(handle: HANDLE) -> Option<FileIdentity> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(handle, &mut info) };
    if ok == 0 {
        return None;
    }
    let file_id = ((info.nFileIndexHigh as u64) << 32) | (info.nFileIndexLow as u64);
    if file_id == 0 {
        return None;
    }
    Some(FileIdentity {
        volume_serial: info.dwVolumeSerialNumber,
        file_id,
    })
}

/// 以只读属性方式打开文件/目录句柄（BACKUP_SEMANTICS 使目录也可打开）。
fn open_metadata_handle(path: &str) -> Option<HANDLE> {
    let wide = to_wide(path);
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_READ_ATTRIBUTES,
            SHARE_ALL,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        None
    } else {
        Some(handle)
    }
}

/// 按文件身份重定位当前路径。
/// 先尝试 `hint_path`（上次已知路径）所在盘符，未果再枚举其余逻辑盘符。
/// 仅当重定位到的文件身份与 `identity` 完全一致（卷序列号 + 文件ID）时才返回，
/// 避免不同卷上恰好相同文件ID造成误判。找不到返回 None。
pub fn resolve_path(identity: FileIdentity, hint_path: &str) -> Option<String> {
    let mut roots: Vec<String> = Vec::new();
    // 盘符根（本地盘/映射网络盘）或 UNC 共享根（NAS：\\server\share\）都可作卷句柄；
    // OpenFileById 经 SMB2+ 同样支持按文件ID打开，失败则自然回退 None。
    if let Some(root) = drive_root_of(hint_path).or_else(|| unc_root_of(hint_path)) {
        roots.push(root);
    }
    for root in logical_drive_roots() {
        if !roots.iter().any(|r| r.eq_ignore_ascii_case(&root)) {
            roots.push(root);
        }
    }

    for root in roots {
        // 直接用 OpenFileById 得到的句柄读取身份与路径，避免再按路径二次 CreateFileW
        //（既省一次 syscall，也消除二次打开因共享冲突/瞬时锁失败而把合法移动误标失效的窗口）。
        if let Some((resolved_identity, resolved_path)) = open_by_id_on_volume(&root, identity.file_id) {
            // 校验重定位结果确实是同一对象（卷序列号 + 文件ID 都匹配）
            if resolved_identity == identity {
                return Some(resolved_path);
            }
        }
    }
    None
}

/// 从绝对路径取盘符根，如 `D:\dir\file` → `D:\`。兼容扩展前缀形态 `\\?\D:\x`。
fn drive_root_of(path: &str) -> Option<String> {
    let normalized = path.strip_prefix(r"\\?\").unwrap_or(path);
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        Some(format!("{}:\\", bytes[0] as char))
    } else {
        None
    }
}

/// 从 UNC 路径取共享根：`\\server\share\dir\file` → `\\server\share\`。
/// 兼容扩展前缀形态 `\\?\UNC\server\share\x`。非 UNC / 缺共享段时返回 None。
fn unc_root_of(path: &str) -> Option<String> {
    let body = if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        rest
    } else if path.starts_with(r"\\?\") {
        // \\?\C:\ 盘符形态交给 drive_root_of
        return None;
    } else {
        path.strip_prefix(r"\\")?
    };
    let mut parts = body.splitn(3, '\\');
    let server = parts.next()?;
    let share = parts.next()?;
    if server.is_empty() || share.is_empty() {
        return None;
    }
    Some(format!(r"\\{}\{}\", server, share))
}

/// 枚举所有逻辑盘符根（如 `C:\`、`D:\`）。
fn logical_drive_roots() -> Vec<String> {
    let mut buf = [0u16; 512];
    let len = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) };
    if len == 0 || len as usize > buf.len() {
        return Vec::new();
    }
    // 形如 "C:\\\0D:\\\0\0"，以 NUL 分隔
    buf[..len as usize]
        .split(|&c| c == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf16_lossy(s))
        .collect()
}

/// 在指定卷上用文件ID打开目标，返回 (该句柄读到的真实身份, 当前路径)。失败返回 None。
fn open_by_id_on_volume(volume_root: &str, file_id: u64) -> Option<(FileIdentity, String)> {
    // 1) 打开卷根目录作为 OpenFileById 的卷句柄（目录需 BACKUP_SEMANTICS）
    let root_wide = to_wide(volume_root);
    let hvol = unsafe {
        CreateFileW(
            root_wide.as_ptr(),
            FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
            SHARE_ALL,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if hvol == INVALID_HANDLE_VALUE {
        return None;
    }

    // 2) 按 64 位文件ID打开目标
    let descriptor = FILE_ID_DESCRIPTOR {
        dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: 0, // FileIdType：使用 64 位 FileId 字段
        Anonymous: FILE_ID_DESCRIPTOR_0 {
            FileId: file_id as i64,
        },
    };
    let hfile = unsafe {
        OpenFileById(
            hvol,
            &descriptor,
            0, // 仅需读取路径，无需访问权限
            SHARE_ALL,
            std::ptr::null(),
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    };
    unsafe { CloseHandle(hvol) };

    if hfile == INVALID_HANDLE_VALUE {
        return None;
    }

    // 3) 从同一句柄读取身份与当前规范化路径（无需再按路径重开）
    let identity = identity_from_handle(hfile);
    let path = final_path_by_handle(hfile);
    unsafe { CloseHandle(hfile) };
    match (identity, path) {
        (Some(id), Some(p)) => Some((id, p)),
        _ => None,
    }
}

/// 取句柄对应文件的当前路径，并去除 `\\?\` 前缀。
fn final_path_by_handle(handle: HANDLE) -> Option<String> {
    let mut buf = vec![0u16; 1024];
    loop {
        let needed = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                buf.as_mut_ptr(),
                buf.len() as u32,
                FILE_NAME_NORMALIZED,
            )
        };
        if needed == 0 {
            return None;
        }
        // 缓冲不足时 Win32 返回"含 NUL 的所需大小"(> 容量)；用 >= 一律扩容重试以贴合规范、消除边界歧义。
        if needed as usize >= buf.len() {
            buf = vec![0u16; needed as usize + 1];
            continue;
        }
        let raw = String::from_utf16_lossy(&buf[..needed as usize]);
        return Some(strip_extended_prefix(&raw));
    }
}

/// 去除 GetFinalPathNameByHandle 返回的扩展长度前缀：`\\?\C:\x` → `C:\x`，`\\?\UNC\srv\s` → `\\srv\s`。
fn strip_extended_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────
// 内容签名：跨盘符移动后的兜底重定位
//
// 文件ID 仅在单卷内稳定，跨盘符（卷序列号变化）后失效。内容签名以
// (文件大小 + 首/尾各 16KB 的 FNV-1a 哈希) 作为弱身份：仅当对象失效时，
// 在候选盘按 size 廉价预筛、再哈希校验找回同一文件。不做实时监控。
// ─────────────────────────────────────────────────────────────────────────

/// 首/尾各采样的字节数。
const SIGNATURE_SAMPLE: u64 = 16 * 1024;

/// 文件内容签名（弱身份，用于跨盘兜底匹配）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileSignature {
    pub size: u64,
    pub head_hash: u64,
    pub tail_hash: u64,
}

/// FNV-1a 64 位哈希：实现稳定、零依赖，适合持久化后跨进程比对。
fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 计算文件内容签名。仅对**文件**生效（目录/不存在/读失败返回 None）。
/// 读取首 16KB 与尾 16KB（小文件则整体），开销恒定，与文件大小无关。
pub fn compute_signature(path: &str) -> Option<FileSignature> {
    let meta = std::fs::metadata(Path::new(path)).ok()?;
    if !meta.is_file() {
        return None;
    }
    let size = meta.len();
    if size == 0 {
        // 空文件无内容可区分：所有空文件签名必然相同，按签名找回会把对象误重定位到
        // 任意一个空文件。返回 None 使其不参与内容签名找回（空文件无需按内容识别）。
        return None;
    }

    let mut file = std::fs::File::open(Path::new(path)).ok()?;

    let head_len = size.min(SIGNATURE_SAMPLE) as usize;
    let mut head = vec![0u8; head_len];
    file.read_exact(&mut head).ok()?;
    let head_hash = fnv1a_64(&head);

    let tail_len = size.min(SIGNATURE_SAMPLE);
    file.seek(SeekFrom::Start(size - tail_len)).ok()?;
    let mut tail = vec![0u8; tail_len as usize];
    file.read_exact(&mut tail).ok()?;
    let tail_hash = fnv1a_64(&tail);

    Some(FileSignature {
        size,
        head_hash,
        tail_hash,
    })
}

/// 候选盘根目录（所有逻辑盘），供按签名跨盘扫描使用。
pub fn candidate_roots() -> Vec<String> {
    logical_drive_roots()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(label: &str) -> std::path::PathBuf {
        // 加 label 隔离，避免并行测试共用同一临时目录互相干扰
        let mut base = std::env::temp_dir();
        base.push(format!("tl_fileid_{}_{}", std::process::id(), label));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("create temp dir");
        base
    }

    #[test]
    fn identity_survives_rename_and_move_then_resolves_new_path() {
        let dir = unique_dir("rename_move");
        let orig = dir.join("orig.txt");
        std::fs::write(&orig, b"hello").expect("write file");
        let orig_str = orig.to_string_lossy().to_string();

        let identity = match get_identity(&orig_str) {
            Some(id) => id,
            // 临时目录不在 NTFS（如 FAT/网络盘）时无法取得身份，跳过该用例
            None => {
                eprintln!("skip: 临时目录文件系统不支持文件ID");
                let _ = std::fs::remove_dir_all(&dir);
                return;
            }
        };

        // 重命名 → 应能按身份找回新路径，且身份不变
        let renamed = dir.join("renamed.txt");
        std::fs::rename(&orig, &renamed).expect("rename");
        let resolved = resolve_path(identity, &orig_str).expect("resolve after rename");
        assert_eq!(get_identity(&resolved), Some(identity));
        assert!(resolved.to_lowercase().ends_with("renamed.txt"));

        // 同盘移动到子目录 → 仍能找回
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).expect("create subdir");
        let moved = sub.join("moved.txt");
        std::fs::rename(&renamed, &moved).expect("move");
        let resolved2 =
            resolve_path(identity, &renamed.to_string_lossy()).expect("resolve after move");
        assert_eq!(get_identity(&resolved2), Some(identity));
        assert!(resolved2.to_lowercase().ends_with("moved.txt"));

        // 注：删除后 resolve_path 是否返回 None 取决于该 MFT 记录是否被同卷新文件复用
        //（见 identity_from_handle 注释的已知局限），属环境相关行为，不在此处断言。
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identity_works_for_directories() {
        let dir = unique_dir("dir");
        let orig = dir.join("orig_folder");
        std::fs::create_dir_all(&orig).expect("create folder");
        let orig_str = orig.to_string_lossy().to_string();

        let identity = match get_identity(&orig_str) {
            Some(id) => id,
            None => {
                eprintln!("skip: 文件系统不支持文件ID");
                let _ = std::fs::remove_dir_all(&dir);
                return;
            }
        };

        // 文件夹重命名 → 按身份找回
        let renamed = dir.join("renamed_folder");
        std::fs::rename(&orig, &renamed).expect("rename folder");
        let resolved = resolve_path(identity, &orig_str).expect("resolve folder after rename");
        assert_eq!(get_identity(&resolved), Some(identity));
        assert!(resolved.to_lowercase().ends_with("renamed_folder"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn root_extraction_handles_drive_unc_and_extended_prefixes() {
        // 盘符形态（含扩展前缀）
        assert_eq!(drive_root_of(r"D:\dir\file.txt"), Some(r"D:\".to_string()));
        assert_eq!(drive_root_of(r"\\?\D:\dir\file.txt"), Some(r"D:\".to_string()));
        assert_eq!(drive_root_of(r"\\server\share\x"), None);

        // UNC 形态（NAS 共享）：提取共享根供 OpenFileById 卷句柄使用
        assert_eq!(
            unc_root_of(r"\\nas\media\videos\a.mp4"),
            Some(r"\\nas\media\".to_string())
        );
        assert_eq!(
            unc_root_of(r"\\?\UNC\nas\media\videos\a.mp4"),
            Some(r"\\nas\media\".to_string())
        );
        // 盘符/不完整 UNC 不产生根
        assert_eq!(unc_root_of(r"D:\dir\file.txt"), None);
        assert_eq!(unc_root_of(r"\\?\D:\dir\file.txt"), None);
        assert_eq!(unc_root_of(r"\\serveronly"), None);

        // 扩展前缀剥离（GetFinalPathNameByHandle 返回形态 → 存储形态）
        assert_eq!(strip_extended_prefix(r"\\?\C:\a\b"), r"C:\a\b");
        assert_eq!(strip_extended_prefix(r"\\?\UNC\nas\share\f"), r"\\nas\share\f");
        assert_eq!(strip_extended_prefix(r"C:\plain"), r"C:\plain");
    }

    #[test]
    fn file_id_hex_round_trips() {
        let id = FileIdentity {
            volume_serial: 0x1234abcd,
            file_id: 0x0001_0000_0000_002a,
        };
        let hex = id.file_id_hex();
        assert_eq!(FileIdentity::parse_file_id_hex(&hex), Some(id.file_id));
    }

    #[test]
    fn signature_matches_identical_content_regardless_of_path() {
        // 同一内容复制到不同路径（模拟跨盘移动后内容不变）→ 签名应一致；
        // 改一个字节 → 签名应不同。
        let dir = unique_dir("signature");
        let a = dir.join("a.bin");
        let b = dir.join("nested").join("b.bin");
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();
        let mut data = vec![0u8; 40 * 1024];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = (i % 251) as u8;
        }
        std::fs::write(&a, &data).unwrap();
        std::fs::write(&b, &data).unwrap();

        let sa = compute_signature(&a.to_string_lossy()).expect("sig a");
        let sb = compute_signature(&b.to_string_lossy()).expect("sig b");
        assert_eq!(sa, sb, "相同内容不同路径签名应一致");

        // 改尾部一个字节
        let mut data2 = data.clone();
        *data2.last_mut().unwrap() ^= 0xff;
        let c = dir.join("c.bin");
        std::fs::write(&c, &data2).unwrap();
        let sc = compute_signature(&c.to_string_lossy()).expect("sig c");
        assert_ne!(sa, sc, "内容不同签名应不同");

        // 目录无签名
        assert!(compute_signature(&dir.to_string_lossy()).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
