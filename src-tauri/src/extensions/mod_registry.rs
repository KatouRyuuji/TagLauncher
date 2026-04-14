use crate::models::{ModInfo, ModManifest};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Mod 注册表：管理已发现的 mod 及其启用状态
pub struct ModRegistry {
    mods: Mutex<HashMap<String, ModEntry>>,
}

struct ModEntry {
    manifest: ModManifest,
    path: PathBuf,
    enabled: bool,
}

impl ModRegistry {
    pub fn new() -> Self {
        Self {
            mods: Mutex::new(HashMap::new()),
        }
    }

    /// 注册一个 mod
    pub fn register(&self, manifest: ModManifest, path: PathBuf, enabled: bool) {
        let id = manifest.id.clone();
        self.mods.lock().unwrap().insert(
            id,
            ModEntry {
                manifest,
                path,
                enabled,
            },
        );
    }

    /// 获取所有 mod 的信息
    pub fn list_mods(&self) -> Vec<ModInfo> {
        let mods = self.mods.lock().unwrap();
        mods.values()
            .map(|entry| ModInfo {
                manifest: entry.manifest.clone(),
                enabled: entry.enabled,
                path: entry.path.to_string_lossy().to_string(),
            })
            .collect()
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
