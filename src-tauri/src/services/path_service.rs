use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct AppPaths {
    pub root_dir: PathBuf,
    pub builtin_dir: PathBuf,
    pub themes_dir: PathBuf,
    pub mods_dir: PathBuf,
    pub save_dir: PathBuf,
}

impl AppPaths {
    pub fn ensure_dirs(&self) -> Result<(), String> {
        for dir in [
            &self.builtin_dir,
            &self.themes_dir,
            &self.mods_dir,
            &self.save_dir,
        ] {
            std::fs::create_dir_all(dir).map_err(|e| format!("无法创建目录 {:?}: {}", dir, e))?;
        }
        Ok(())
    }
}

pub fn resolve_app_paths(app: &AppHandle) -> Result<AppPaths, String> {
    let root_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .or_else(|| app.path().resource_dir().ok())
        .or_else(|| app.path().app_data_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    // 数据目录重定向：exe 旁的 datapath.json 可将 Save/ 指向自定义位置。
    // 仅影响应用原生数据（Save/），Builtin / Plugins 仍固定在 exe 同级。
    let save_dir = match read_data_dir_redirect(&root_dir)? {
        Some(dir) => dir,
        None => default_save_dir(&root_dir),
    };

    Ok(AppPaths {
        builtin_dir: root_dir.join("Builtin"),
        themes_dir: root_dir.join("Plugins_Theme"),
        mods_dir: root_dir.join("Plugins_Mods"),
        save_dir,
        root_dir,
    })
}

/// 默认数据目录：`%LOCALAPPDATA%\TagLauncher\Save\`。
/// 数据与程序目录解耦（对标主流桌面应用：Chrome/JetBrains/Joplin 等均把数据库
/// 放在本机用户数据目录）——升级版本、重装、删除程序目录都不再影响数据；
/// 数据库内容含本机文件路径索引（机器相关），故用 Local 而非 Roaming。
/// LOCALAPPDATA 缺失（损坏环境）时兜底 exe 同级 Save/。
pub fn default_save_dir(root_dir: &std::path::Path) -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .map(|p| p.join("TagLauncher").join("Save"))
        .unwrap_or_else(|| root_dir.join("Save"))
}

const DATA_REDIRECT_FILE: &str = "datapath.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct DataRedirect {
    save_dir: String,
}

/// 读取数据目录重定向配置。
/// 文件不存在 → `Ok(None)`，调用方使用默认目录。
/// 文件存在但无法读取、JSON 损坏或 `save_dir` 为空 → `Err`，保留原文件，不得静默改用另一库。
/// 相对路径（如手工编辑的 datapath.json）锚定到 root_dir，避免随进程 CWD 漂移。
pub fn read_data_dir_redirect(root_dir: &std::path::Path) -> Result<Option<PathBuf>, String> {
    let file = root_dir.join(DATA_REDIRECT_FILE);
    let content = match std::fs::read_to_string(&file) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(format!(
                "数据目录配置 datapath.json 无法读取（已保留原文件，请修复后重试）: {e}"
            ))
        }
    };
    let redirect: DataRedirect = serde_json::from_str(&content).map_err(|e| {
        format!("数据目录配置 datapath.json 已损坏（已保留原文件，请修复或删除后重试）: {e}")
    })?;
    let trimmed = redirect.save_dir.trim();
    if trimmed.is_empty() {
        return Err(
            "数据目录配置 datapath.json 的 save_dir 为空（已保留原文件，请修复后重试）".to_string(),
        );
    }
    let path = PathBuf::from(trimmed);
    Ok(Some(if path.is_absolute() {
        path
    } else {
        root_dir.join(path)
    }))
}

/// 写入或清除数据目录重定向配置（原子写：先写临时文件再重命名）。
pub fn write_data_dir_redirect(
    root_dir: &std::path::Path,
    save_dir: Option<&std::path::Path>,
) -> Result<(), String> {
    let target = root_dir.join(DATA_REDIRECT_FILE);
    match save_dir {
        None => {
            if target.exists() {
                std::fs::remove_file(&target).map_err(|e| format!("清除数据目录配置失败: {}", e))?;
            }
            Ok(())
        }
        Some(dir) => {
            let json = serde_json::to_string_pretty(&DataRedirect {
                save_dir: dir.to_string_lossy().to_string(),
            })
            .map_err(|e| e.to_string())?;
            let tmp = root_dir.join(format!("{}.tmp", DATA_REDIRECT_FILE));
            std::fs::write(&tmp, json).map_err(|e| format!("写入数据目录配置失败: {}", e))?;
            std::fs::rename(&tmp, &target).map_err(|e| format!("写入数据目录配置失败: {}", e))?;
            Ok(())
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn unique_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tl_datapath_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_datapath_uses_default_and_corrupt_file_is_kept() {
        let root = unique_root("ok");
        assert_eq!(read_data_dir_redirect(&root).unwrap(), None);
        let file = root.join(DATA_REDIRECT_FILE);
        std::fs::write(&file, "{not-json").unwrap();
        let original = std::fs::read(&file).unwrap();
        let err = read_data_dir_redirect(&root).unwrap_err();
        assert!(err.contains("已损坏") || err.contains("已保留原文件"), "{err}");
        assert_eq!(std::fs::read(&file).unwrap(), original, "损坏配置不得改写或改用另一库");

        std::fs::write(&file, "{\n  \"save_dir\": \"   \"\n}\n").unwrap();
        let err = read_data_dir_redirect(&root).unwrap_err();
        assert!(err.contains("为空"), "{err}");
        assert!(file.exists());

        write_data_dir_redirect(&root, Some(&root.join("CustomSave"))).unwrap();
        let got = read_data_dir_redirect(&root).unwrap().expect("valid");
        assert_eq!(got, root.join("CustomSave"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
