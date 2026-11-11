//! 「打开」时的逐级浏览落点（与 nestedVisibility.ts 的 browseTargetForItem 一致）。
//! 主窗不再持有全量对象，这一判定需要库内全部路径，故在后端按 SQL 取路径做。

use super::{dir_key, is_under_dir, normalize_dir, parent_dir};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct PathEntry {
    pub id: i64,
    pub path: String,
    pub is_folder: bool,
    pub hide_from_all: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrowseTarget {
    pub root: String,
    pub dir: Option<String>,
}

fn dir_equals(a: &str, b: &str) -> bool {
    dir_key(a) == dir_key(b)
}

pub fn has_library_descendants(
    folder_path: &str,
    items: &[PathEntry],
    folder_id: Option<i64>,
) -> bool {
    items
        .iter()
        .any(|it| folder_id != Some(it.id) && is_under_dir(&it.path, folder_path))
}

pub fn nearest_browse_root(path: &str, items: &[PathEntry]) -> String {
    let pick = |visible_only: bool| {
        let mut best: Option<&str> = None;
        for f in items
            .iter()
            .filter(|it| it.is_folder && (!visible_only || !it.hide_from_all))
        {
            if dir_equals(&f.path, path) || is_under_dir(path, &f.path) {
                // 严格更长才替换：与 TS 的 `>` 一致，同长取先出现者
                if best.map_or(true, |b| {
                    normalize_dir(&f.path).len() > normalize_dir(b).len()
                }) {
                    best = Some(&f.path);
                }
            }
        }
        best.map(normalize_dir)
    };
    if let Some(b) = pick(true).or_else(|| pick(false)) {
        return b;
    }
    let parent = parent_dir(path);
    if parent.is_empty() {
        normalize_dir(path)
    } else {
        parent
    }
}

/// `item` 本身也须在 `items` 中（或至少按 id 排除自身）。
pub fn browse_target(
    item: &PathEntry,
    is_missing: bool,
    items: &[PathEntry],
) -> Option<BrowseTarget> {
    if is_missing {
        return None;
    }
    if item.is_folder && has_library_descendants(&item.path, items, Some(item.id)) {
        return Some(BrowseTarget {
            root: normalize_dir(&item.path),
            dir: None,
        });
    }
    if item.hide_from_all {
        let root = nearest_browse_root(&item.path, items);
        let dir = if item.is_folder {
            normalize_dir(&item.path)
        } else {
            parent_dir(&item.path)
        };
        return Some(BrowseTarget {
            root,
            dir: if dir.is_empty() { None } else { Some(dir) },
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(id: i64, path: &str, is_folder: bool, hide: bool) -> PathEntry {
        PathEntry {
            id,
            path: path.into(),
            is_folder,
            hide_from_all: hide,
        }
    }

    // 与 nestedVisibility.test.ts 的同名用例对应
    #[test]
    fn folder_with_descendants_and_hidden_file() {
        let hidden = e(2, "D:\\Lib\\Folder\\a.txt", false, true);
        let folder = e(1, "D:\\Lib\\Folder", true, false);
        let nested = e(3, "D:\\Lib\\Folder\\Sub", true, true);
        let loose = e(5, "D:\\loose.exe", false, false);
        let items = vec![
            folder.clone(),
            nested.clone(),
            hidden.clone(),
            loose.clone(),
        ];
        assert!(has_library_descendants(&folder.path, &items, Some(1)));
        assert_eq!(
            browse_target(&folder, false, &items),
            Some(BrowseTarget {
                root: "D:\\Lib\\Folder".into(),
                dir: None
            })
        );
        assert_eq!(
            browse_target(&hidden, false, &items),
            Some(BrowseTarget {
                root: "D:\\Lib\\Folder".into(),
                dir: Some("D:\\Lib\\Folder".into())
            })
        );
        assert_eq!(browse_target(&loose, false, &items), None);
        assert_eq!(browse_target(&folder, true, &items), None);
        assert_eq!(
            nearest_browse_root(&hidden.path, &[folder, nested, loose]),
            "D:\\Lib\\Folder"
        );
    }

    #[test]
    fn hidden_root_falls_back_to_deepest_folder() {
        let root = e(20, "D:\\Lib\\Docs", true, true);
        let sub = e(21, "D:\\Lib\\Docs\\Sub", true, true);
        let deep = e(22, "D:\\Lib\\Docs\\Sub\\a.txt", false, true);
        let items = vec![root, sub, deep.clone()];
        let t = browse_target(&deep, false, &items).unwrap();
        assert_eq!(t.dir.as_deref(), Some("D:\\Lib\\Docs\\Sub"));
        assert_eq!(t.root, "D:\\Lib\\Docs\\Sub");
    }
}
