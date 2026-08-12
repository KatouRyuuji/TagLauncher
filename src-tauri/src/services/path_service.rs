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

pub fn resolve_app_paths(app: &AppHandle) -> AppPaths {
    let root_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .or_else(|| app.path().resource_dir().ok())
        .or_else(|| app.path().app_data_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    // 数据目录重定向：exe 旁的 datapath.json 可将 Save/ 指向自定义位置。
    // 仅影响应用原生数据（Save/），Builtin / Plugins 仍固定在 exe 同级。
    let save_dir = read_data_dir_redirect(&root_dir).unwrap_or_else(|| root_dir.join("Save"));

    AppPaths {
        builtin_dir: root_dir.join("Builtin"),
        themes_dir: root_dir.join("Plugins_Theme"),
        mods_dir: root_dir.join("Plugins_Mods"),
        save_dir,
        root_dir,
    }
}

/// 默认数据目录（exe 同级 Save/，忽略重定向）。
pub fn default_save_dir(root_dir: &std::path::Path) -> PathBuf {
    root_dir.join("Save")
}

const DATA_REDIRECT_FILE: &str = "datapath.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct DataRedirect {
    save_dir: String,
}

/// 读取数据目录重定向配置。文件缺失、解析失败或指向空字符串时返回 None（回退默认目录）。
/// 相对路径（如手工编辑的 datapath.json）锚定到 root_dir，避免随进程 CWD 漂移。
pub fn read_data_dir_redirect(root_dir: &std::path::Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(root_dir.join(DATA_REDIRECT_FILE)).ok()?;
    let redirect: DataRedirect = serde_json::from_str(&content).ok()?;
    let trimmed = redirect.save_dir.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    Some(if path.is_absolute() {
        path
    } else {
        root_dir.join(path)
    })
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
