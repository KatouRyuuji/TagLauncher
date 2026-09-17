//! 导入路径预检与文件夹展开。
//!
//! 添加对话框需要先知道一批路径里哪些是文件夹；用户选择「加入夹内文件」时，
//! 再递归收集文件。遍历在锁外做，不碰数据库。

use serde::Serialize;
use std::path::{Path, PathBuf};

/// 单次展开的文件数上限，避免把整盘误拖进来卡死导入。
pub const FOLDER_IMPORT_FILE_CAP: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPathClass {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandFolderImportResult {
    pub paths: Vec<String>,
    pub truncated: bool,
}

/// 把路径分成文件与文件夹。不存在的路径按文件处理，交给后续 add_items 报错。
pub fn classify_import_paths(paths: Vec<String>) -> ImportPathClass {
    let mut files = Vec::new();
    let mut folders = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if Path::new(trimmed).is_dir() {
            folders.push(trimmed.to_string());
        } else {
            files.push(trimmed.to_string());
        }
    }
    ImportPathClass { files, folders }
}

/// 文件夹替换为其中的文件（递归）；已是文件的路径原样保留。不加入文件夹对象本身。
pub fn expand_folder_import(paths: Vec<String>) -> ExpandFolderImportResult {
    let mut out = Vec::new();
    let mut truncated = false;
    let mut budget = FOLDER_IMPORT_FILE_CAP;

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let location = Path::new(trimmed);
        if location.is_dir() {
            if !walk_files(location, &mut out, &mut budget) {
                truncated = true;
                break;
            }
        } else {
            if budget == 0 {
                truncated = true;
                break;
            }
            out.push(trimmed.to_string());
            budget = budget.saturating_sub(1);
        }
    }

    ExpandFolderImportResult {
        paths: out,
        truncated,
    }
}

fn walk_files(root: &Path, out: &mut Vec<String>, budget: &mut usize) -> bool {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return true,
    };

    let mut dirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        if *budget == 0 {
            return false;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_name(&name) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if is_hidden_or_system(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            dirs.push(path);
            continue;
        }
        if metadata.is_file() {
            out.push(path.to_string_lossy().to_string());
            *budget = budget.saturating_sub(1);
        }
    }

    for dir in dirs {
        if *budget == 0 {
            return false;
        }
        if !walk_files(&dir, out, budget) {
            return false;
        }
    }
    true
}

fn should_skip_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with('.') || lower.starts_with('$') {
        return true;
    }
    matches!(
        lower.as_str(),
        "desktop.ini" | "thumbs.db" | "ehthumbs.db" | "ehthumbs_vista.db" | "system volume information"
    )
}

fn is_hidden_or_system(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        let attrs = metadata.file_attributes();
        attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "tl_import_{}_{}_{}",
            std::process::id(),
            n,
            nanos
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn classify_splits_files_and_folders() {
        let root = temp_root();
        let file = root.join("clip.mp4");
        fs::write(&file, b"x").unwrap();
        let folder = root.join("movies");
        fs::create_dir(&folder).unwrap();

        let classified = classify_import_paths(vec![
            file.to_string_lossy().to_string(),
            folder.to_string_lossy().to_string(),
            "   ".to_string(),
        ]);
        assert_eq!(classified.files.len(), 1);
        assert_eq!(classified.folders.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn expand_walks_nested_files_and_skips_junk() {
        let root = temp_root();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a.mp4"), b"a").unwrap();
        fs::write(root.join("sub").join("b.png"), b"b").unwrap();
        fs::write(root.join("desktop.ini"), b"junk").unwrap();
        fs::write(root.join(".hidden.txt"), b"no").unwrap();

        let result = expand_folder_import(vec![root.to_string_lossy().to_string()]);
        assert!(!result.truncated);
        assert_eq!(result.paths.len(), 2, "{:?}", result.paths);
        assert!(result.paths.iter().any(|p| p.ends_with("a.mp4")));
        assert!(result.paths.iter().any(|p| p.ends_with("b.png")));
        assert!(result.paths.iter().all(|p| !p.to_ascii_lowercase().contains("desktop.ini")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn expand_keeps_loose_files_and_replaces_folders() {
        let root = temp_root();
        let loose = root.join("alone.exe");
        fs::write(&loose, b"e").unwrap();
        let folder = root.join("pack");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("in.mp3"), b"m").unwrap();

        let result = expand_folder_import(vec![
            loose.to_string_lossy().to_string(),
            folder.to_string_lossy().to_string(),
        ]);
        assert_eq!(result.paths.len(), 2);
        assert!(result.paths.iter().any(|p| p.ends_with("alone.exe")));
        assert!(result.paths.iter().any(|p| p.ends_with("in.mp3")));
        let _ = fs::remove_dir_all(&root);
    }
}
