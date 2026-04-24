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

    AppPaths {
        builtin_dir: root_dir.join("Builtin"),
        themes_dir: root_dir.join("Plugins_Theme"),
        mods_dir: root_dir.join("Plugins_Mods"),
        save_dir: root_dir.join("Save"),
        root_dir,
    }
}
