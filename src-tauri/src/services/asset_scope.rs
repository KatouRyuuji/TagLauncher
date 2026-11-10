//! asset:// 协议的动态授权范围（BUG-18）。
//!
//! tauri.conf.json 里 assetProtocol.scope 为空：WebView 默认读不到任何本地文件。
//! 只放行产品确实要经 convertFileSrc 读取的位置：
//! - 应用自有目录：Save/（图标/缩略图缓存）、Builtin/、Plugins_Theme/、Plugins_Mods/；
//! - 库内对象：文件本身（图片缩略图、快速预览）、文件夹对象递归（预览目录内容）、
//!   用户自定义图标 icon_path。
//! 库外任意路径（如 C:\Windows\...）不再可读。授权随对象经 get_items 等命令下发时
//! 增量追加，已授权路径用集合去重，避免每次列表刷新重复编译 glob。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::models::ItemWithTags;
use crate::services::path_service::AppPaths;
use tauri::{AppHandle, Manager};

/// 一条待放行的授权：路径 + 是否按目录递归放行。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ScopeEntry {
    pub path: PathBuf,
    pub recursive_dir: bool,
}

/// 应用自有目录（递归）。
pub fn entries_for_app_paths(paths: &AppPaths) -> Vec<ScopeEntry> {
    [
        &paths.save_dir,
        &paths.builtin_dir,
        &paths.themes_dir,
        &paths.mods_dir,
    ]
    .into_iter()
    .map(|p| ScopeEntry {
        path: p.clone(),
        recursive_dir: true,
    })
    .collect()
}

/// 单个库对象需要的授权：对象路径（文件夹递归）+ 自定义图标。缺失对象不放行。
pub fn entries_for_item(path: &str, is_missing: bool, icon_path: Option<&str>) -> Vec<ScopeEntry> {
    let mut out = Vec::new();
    let path = path.trim();
    if !is_missing && !path.is_empty() && Path::new(path).is_absolute() {
        let p = PathBuf::from(path);
        let recursive_dir = p.is_dir();
        out.push(ScopeEntry {
            path: p,
            recursive_dir,
        });
    }
    if let Some(icon) = icon_path.map(str::trim).filter(|s| !s.is_empty()) {
        if Path::new(icon).is_absolute() {
            out.push(ScopeEntry {
                path: PathBuf::from(icon),
                recursive_dir: false,
            });
        }
    }
    out
}

fn granted() -> &'static Mutex<HashSet<ScopeEntry>> {
    static GRANTED: OnceLock<Mutex<HashSet<ScopeEntry>>> = OnceLock::new();
    GRANTED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn apply(app: &AppHandle, entries: Vec<ScopeEntry>) {
    let scope = app.asset_protocol_scope();
    let mut seen = granted().lock().unwrap_or_else(|e| e.into_inner());
    for entry in entries {
        if seen.contains(&entry) {
            continue;
        }
        let res = if entry.recursive_dir {
            scope.allow_directory(&entry.path, true)
        } else {
            scope.allow_file(&entry.path)
        };
        match res {
            Ok(()) => {
                seen.insert(entry);
            }
            Err(e) => log::warn!("asset scope 放行失败 {:?}: {}", entry.path, e),
        }
    }
}

pub fn allow_app_paths(app: &AppHandle, paths: &AppPaths) {
    apply(app, entries_for_app_paths(paths));
}

pub fn allow_items(app: &AppHandle, items: &[ItemWithTags]) {
    let entries = items
        .iter()
        .flat_map(|i| {
            entries_for_item(&i.item.path, i.item.is_missing, i.item.icon_path.as_deref())
        })
        .collect();
    apply(app, entries);
}

/// 卡片直接显示的路径：自定义图标、图片对象本身（缩略图）。其余（文件夹递归、普通文件）
/// 留给预览命令按需放行——小视图空闲补齐（get_items_page warm）一次取上千条，
/// 每条一个 glob（约 2 KB 起，另有规范化副本）会让主进程常驻多出几十 MB。
pub fn entries_for_card(
    path: &str,
    is_missing: bool,
    item_type: &str,
    icon_path: Option<&str>,
) -> Vec<ScopeEntry> {
    let mut out = entries_for_item(
        if item_type == "image" { path } else { "" },
        is_missing,
        icon_path,
    );
    out.retain(|e| !e.recursive_dir);
    out
}

pub fn allow_items_for_cards(app: &AppHandle, items: &[ItemWithTags]) {
    let entries = items
        .iter()
        .flat_map(|i| {
            entries_for_card(
                &i.item.path,
                i.item.is_missing,
                &i.item.item_type,
                i.item.icon_path.as_deref(),
            )
        })
        .collect();
    apply(app, entries);
}

pub fn allow_item_visual(app: &AppHandle, path: &str, is_missing: bool, icon_path: Option<&str>) {
    apply(app, entries_for_item(path, is_missing, icon_path));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("tl-asset-scope-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn card_entries_cover_only_what_cards_show() {
        let dir = scratch("card");
        let img = dir.join("a.png");
        let txt = dir.join("b.txt");
        let icon = dir.join("icon.png");
        std::fs::write(&img, b"x").unwrap();
        std::fs::write(&txt, b"x").unwrap();
        let file = |p: &PathBuf| ScopeEntry {
            path: p.clone(),
            recursive_dir: false,
        };
        assert_eq!(
            entries_for_card(img.to_str().unwrap(), false, "image", None),
            vec![file(&img)]
        );
        assert_eq!(
            entries_for_card(txt.to_str().unwrap(), false, "file", None),
            vec![]
        );
        assert_eq!(
            entries_for_card(dir.to_str().unwrap(), false, "folder", None),
            vec![]
        );
        assert_eq!(
            entries_for_card(dir.to_str().unwrap(), false, "folder", icon.to_str()),
            vec![file(&icon)]
        );
        assert_eq!(
            entries_for_card(img.to_str().unwrap(), true, "image", None),
            vec![]
        );
    }

    #[test]
    fn folder_item_is_recursive_file_item_is_not() {
        let dir = scratch("folder");
        let f = dir.join("a.png");
        std::fs::write(&f, b"x").unwrap();
        let e = entries_for_item(dir.to_str().unwrap(), false, None);
        assert_eq!(
            e,
            vec![ScopeEntry {
                path: dir.clone(),
                recursive_dir: true
            }]
        );
        let e = entries_for_item(f.to_str().unwrap(), false, None);
        assert_eq!(
            e,
            vec![ScopeEntry {
                path: f.clone(),
                recursive_dir: false
            }]
        );
    }

    #[test]
    fn missing_or_relative_paths_are_not_granted_but_icon_is() {
        let dir = scratch("missing");
        let icon = dir.join("icon.png");
        let icon_s = icon.to_str().unwrap();
        assert!(entries_for_item("relative/x.png", false, None).is_empty());
        assert!(entries_for_item("", false, Some("  ")).is_empty());
        let e = entries_for_item(dir.join("gone.txt").to_str().unwrap(), true, Some(icon_s));
        assert_eq!(
            e,
            vec![ScopeEntry {
                path: icon,
                recursive_dir: false
            }]
        );
    }

    #[test]
    fn app_dirs_are_recursive() {
        let p = AppPaths {
            root_dir: "/r".into(),
            builtin_dir: "/r/Builtin".into(),
            themes_dir: "/r/Plugins_Theme".into(),
            mods_dir: "/r/Plugins_Mods".into(),
            save_dir: "/s".into(),
        };
        let e = entries_for_app_paths(&p);
        assert_eq!(e.len(), 4);
        assert!(e.iter().all(|x| x.recursive_dir));
        assert!(
            !e.iter().any(|x| x.path == PathBuf::from("/r")),
            "不放行 exe 根目录"
        );
    }
}
