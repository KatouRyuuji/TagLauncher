use crate::models::Item;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
static AUTO_ICON_CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 判断是否有自定义图标路径
fn has_icon_path(item: &Item) -> bool {
    item.icon_path
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

/// 计算自动缩略图/图标路径
fn auto_visual_path(app: &AppHandle, item: &Item) -> Option<String> {
    if item.item_type == "image" {
        return Some(item.path.clone());
    }

    #[cfg(target_os = "windows")]
    {
        let cache_dir = AUTO_ICON_CACHE_DIR.get_or_init(|| {
            app.path()
                .app_cache_dir()
                .or_else(|_| app.path().app_data_dir())
                .unwrap_or_else(|_| std::env::temp_dir().join("taglauncher"))
                .join("item-icons")
        });
        std::fs::create_dir_all(cache_dir).ok()?;

        let cached_path = icon_cache_path(cache_dir, &item.path);
        if cached_path.exists() {
            return Some(cached_path.to_string_lossy().to_string());
        }

        if extract_associated_icon_to_png(&item.path, &cached_path).ok()? {
            return Some(cached_path.to_string_lossy().to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = app;

    None
}

/// 为项目列表补齐自动可视路径
pub fn fill_auto_visual_paths(app: &AppHandle, items: &mut [Item]) {
    for item in items.iter_mut() {
        if has_icon_path(item) {
            continue;
        }
        if let Some(auto_path) = auto_visual_path(app, item) {
            item.icon_path = Some(auto_path);
        }
    }
}

#[cfg(target_os = "windows")]
fn icon_cache_path(cache_dir: &Path, input_path: &str) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::UNIX_EPOCH;

    let mut hasher = DefaultHasher::new();
    input_path.to_lowercase().hash(&mut hasher);

    if let Ok(meta) = std::fs::metadata(input_path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                duration.as_secs().hash(&mut hasher);
            }
        }
    }

    cache_dir.join(format!("{:016x}.png", hasher.finish()))
}

#[cfg(target_os = "windows")]
fn extract_associated_icon_to_png(input_path: &str, output_path: &Path) -> Result<bool, String> {
    let in_path = input_path.replace('\'', "''");
    let out_path = output_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
$in = '{in_path}';
$out = '{out_path}';
Add-Type -AssemblyName System.Drawing;
try {{
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($in);
  if ($null -eq $icon) {{ exit 2 }}
  $bmp = $icon.ToBitmap();
  $dir = [System.IO.Path]::GetDirectoryName($out);
  if (-not [string]::IsNullOrWhiteSpace($dir)) {{
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
  }}
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png);
  $bmp.Dispose();
  $icon.Dispose();
  exit 0
}} catch {{
  exit 1
}}
"#
    );

    let status = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .status()
        .map_err(|e| e.to_string())?;

    Ok(status.success() && output_path.exists())
}
