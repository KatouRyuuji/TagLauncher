use crate::models::{ModInfo, ModLoadError, ModManifest};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Mod 注册表：管理已发现的 mod 及其启用状态
pub struct ModRegistry {
    mods: Mutex<HashMap<String, ModEntry>>,
    load_errors: Mutex<Vec<ModLoadError>>,
}

struct ModEntry {
    manifest: ModManifest,
    path: PathBuf,
    enabled: bool,
    is_compatible: bool,
    incompatible_reason: Option<String>,
}

impl ModRegistry {
    pub fn new() -> Self {
        Self {
            mods: Mutex::new(HashMap::new()),
            load_errors: Mutex::new(Vec::new()),
        }
    }

    /// 注册一个 mod
    pub fn register(
        &self,
        manifest: ModManifest,
        path: PathBuf,
        enabled: bool,
        is_compatible: bool,
        incompatible_reason: Option<String>,
    ) {
        let id = manifest.id.clone();
        self.mods.lock().unwrap().insert(
            id,
            ModEntry {
                manifest,
                path,
                enabled,
                is_compatible,
                incompatible_reason,
            },
        );
    }

    /// 记录一个 mod 加载错误
    pub fn add_load_error(&self, dir_name: String, error: String) {
        self.load_errors
            .lock()
            .unwrap()
            .push(ModLoadError { dir_name, error });
    }

    /// 获取所有 mod 加载错误
    pub fn get_load_errors(&self) -> Vec<ModLoadError> {
        self.load_errors.lock().unwrap().clone()
    }

    /// 获取所有 mod 的信息（按 id 字母序稳定排序）
    pub fn list_mods(&self) -> Vec<ModInfo> {
        let mods = self.mods.lock().unwrap();
        let mut list: Vec<ModInfo> = mods
            .values()
            .map(|entry| ModInfo {
                manifest: entry.manifest.clone(),
                enabled: entry.enabled,
                path: entry.path.to_string_lossy().to_string(),
                is_compatible: entry.is_compatible,
                incompatible_reason: entry.incompatible_reason.clone(),
            })
            .collect();
        list.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
        list
    }

    /// 获取 mod 目录路径
    pub fn get_mod_path(&self, mod_id: &str) -> Option<PathBuf> {
        let mods = self.mods.lock().unwrap();
        mods.get(mod_id).map(|e| e.path.clone())
    }

    /// 启用 mod
    pub fn enable_mod(&self, mod_id: &str) -> bool {
        let mut mods = self.mods.lock().unwrap();
        if let Some(entry) = mods.get_mut(mod_id) {
            entry.enabled = true;
            true
        } else {
            false
        }
    }

    /// 禁用 mod
    pub fn disable_mod(&self, mod_id: &str) -> bool {
        let mut mods = self.mods.lock().unwrap();
        if let Some(entry) = mods.get_mut(mod_id) {
            entry.enabled = false;
            true
        } else {
            false
        }
    }
}
