use crate::models::Item;
use crate::services::object_preview_service;
#[cfg(target_os = "windows")]
use crate::services::shell_thumbnail;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;
use tauri::AppHandle;

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
            crate::services::path_service::resolve_app_paths(app)
                .save_dir
                .join("item-icons")
        });
        std::fs::create_dir_all(cache_dir).ok()?;

        if item.item_type == "audio" {
            if let Some(path) = audio_cover_cached_path(cache_dir, &item.path) {
                return Some(path.to_string_lossy().to_string());
            }
            return None;
        }

        // 视频：优先系统缩略图（资源管理器同款首帧画面），取不到再回退关联图标。
        // 缓存键带 -vt 后缀，与旧版「视频按 exe 归类」时期落的关联图标缓存区分开。
        if item.item_type == "video" {
            if let Some(path) = video_thumbnail_cached_path(cache_dir, &item.path) {
                return Some(path.to_string_lossy().to_string());
            }
            // 缩略图不可用（损坏/无解码器）：回退到关联图标，继续走下方通用流程
        }

        // 快捷方式按目标图标缓存，普通对象按系统图标缓存。
        let cache_suffix = if is_shortcut_path(&item.path) { "-lnk" } else { "-shell" };
        let cache_key = icon_cache_key(&item.path);
        let cached_path = cache_dir.join(format!("{}{}.png", cache_key, cache_suffix));
        if cached_path.exists() {
            return Some(cached_path.to_string_lossy().to_string());
        }

        // 失败结果冷却 30 秒后重试；文件大小或修改时间变化时采用新的缓存键。
        let none_marker = cache_dir.join(format!("{}{}.none", cache_key, cache_suffix));
        if none_marker_is_fresh(&none_marker, std::time::Duration::from_secs(30)) {
            return None;
        }

        match extract_associated_icon_to_png(&item.path, &cached_path) {
            Ok(true) => return Some(cached_path.to_string_lossy().to_string()),
            Ok(false) => {
                let _ = std::fs::write(none_marker, []);
            }
            Err(error) => {
                eprintln!("[icons] 系统图标读取失败 ({}): {}", item.path, error);
                let _ = std::fs::write(none_marker, []);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = app;

    None
}

/// 为单个项目补齐自动可视路径（图标提取/封面，涉及文件系统与 PowerShell IO，不依赖 DB）。
pub fn fill_item_visual(app: &AppHandle, item: &mut Item) {
    if has_icon_path(item) {
        return;
    }
    if let Some(auto_path) = auto_visual_path(app, item) {
        item.icon_path = Some(auto_path);
    }
}

#[cfg(target_os = "windows")]
fn is_shortcut_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn icon_cache_key(input_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::UNIX_EPOCH;

    let mut hasher = DefaultHasher::new();
    input_path.to_lowercase().hash(&mut hasher);

    if let Ok(meta) = std::fs::metadata(input_path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                duration.as_nanos().hash(&mut hasher);
            }
        }
    }

    format!("{:016x}", hasher.finish())
}

#[cfg(target_os = "windows")]
fn audio_cover_cached_path(cache_dir: &Path, input_path: &str) -> Option<PathBuf> {
    let key = icon_cache_key(input_path);
    let no_cover_marker = cache_dir.join(format!("{}-cover.none", key));
    if no_cover_marker.exists() {
        return None;
    }

    for ext in ["jpg", "jpeg", "png", "gif", "bmp", "tiff"] {
        let cached = cache_dir.join(format!("{}-cover.{}", key, ext));
        if cached.exists() {
            return Some(cached);
        }
    }

    let cover = object_preview_service::extract_audio_cover(input_path).ok().flatten();
    let Some((mime, bytes)) = cover else {
        let _ = std::fs::write(no_cover_marker, []);
        return None;
    };
    let ext = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => {
            let _ = std::fs::write(no_cover_marker, []);
            return None;
        }
    };
    let output_path = cache_dir.join(format!("{}-cover.{}", key, ext));
    std::fs::write(&output_path, bytes).ok()?;
    Some(output_path)
}

#[cfg(target_os = "windows")]
const VIDEO_THUMB_NONE_TTL: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// `.none` 标记在 TTL 内视为有效（跳过重试）；读不到 mtime 时保守视为有效。
#[cfg(target_os = "windows")]
fn none_marker_is_fresh(path: &Path, ttl: std::time::Duration) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return true;
    };
    match modified.elapsed() {
        Ok(elapsed) => elapsed < ttl,
        Err(_) => true,
    }
}

#[cfg(target_os = "windows")]
fn video_thumbnail_cached_path(cache_dir: &Path, input_path: &str) -> Option<PathBuf> {
    let key = icon_cache_key(input_path);
    let thumb_path = cache_dir.join(format!("{}-vt.png", key));
    if thumb_path.exists() {
        return Some(thumb_path);
    }

    // 负缓存：取不到系统缩略图时冷却一段时间再试。
    // Windows 常在资源管理器首次访问后才生成缩略图，永久 .none 会把后补的首帧永远挡掉。
    let none_marker = cache_dir.join(format!("{}-vt.none", key));
    if none_marker_is_fresh(&none_marker, VIDEO_THUMB_NONE_TTL) {
        return None;
    }
    let _ = std::fs::remove_file(&none_marker);

    match shell_thumbnail::save_shell_thumbnail_png(input_path, &thumb_path) {
        Ok(()) if thumb_path.exists() => Some(thumb_path),
        _ => {
            let _ = std::fs::write(none_marker, []);
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn extract_associated_icon_to_png(input_path: &str, output_path: &Path) -> Result<bool, String> {
    if is_shortcut_path(input_path) {
        return extract_shortcut_icon_to_png(input_path, output_path);
    }
    shell_thumbnail::save_shell_icon_png(input_path, output_path)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn extract_shortcut_icon_to_png(input_path: &str, output_path: &Path) -> Result<bool, String> {
    let in_path = input_path.replace('\'', "''");
    let out_path = output_path.to_string_lossy().replace('\'', "''");
    // .lnk 先经 WScript.Shell 解析到目标（或自定义 IconLocation）再取图标：
    // 直接 ExtractAssociatedIcon(lnk) 会带上 Windows 快捷方式箭头角标。
    // 解析失败（目标丢失等）回退为对 .lnk 本体取图标。
    let script = format!(
        r#"
$in = '{in_path}';
$out = '{out_path}';
Add-Type -AssemblyName System.Drawing;
try {{
  if ($in.ToLower().EndsWith('.lnk')) {{
    try {{
      $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($in);
      $resolved = $null;
      if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) {{ $resolved = $sc.TargetPath }}
      if (-not $resolved -and $sc.IconLocation) {{
        $iconFile = ($sc.IconLocation -replace ',\d+$', '').Trim('"');
        if ($iconFile -and (Test-Path $iconFile)) {{ $resolved = $iconFile }}
      }}
      if ($resolved) {{ $in = $resolved }}
    }} catch {{}}
  }}
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{none_marker_is_fresh, VIDEO_THUMB_NONE_TTL};
    use std::time::Duration;

    #[test]
    fn missing_none_marker_is_not_fresh() {
        assert!(!none_marker_is_fresh(
            std::path::Path::new("Z:\\no-such-tl-none-marker"),
            VIDEO_THUMB_NONE_TTL
        ));
    }

    #[test]
    fn just_written_none_marker_is_fresh() {
        let p = std::env::temp_dir().join(format!(
            "tl-none-{}.none",
            std::process::id()
        ));
        std::fs::write(&p, []).expect("write marker");
        assert!(none_marker_is_fresh(&p, Duration::from_secs(600)));
        assert!(!none_marker_is_fresh(&p, Duration::from_secs(0)));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn native_and_process_icon_extraction_produce_png() {
        let dir = std::env::temp_dir().join(format!("tl-icon-paths-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("图标基准.txt");
        std::fs::write(&file, b"icon benchmark").unwrap();
        let input = file.to_string_lossy();
        let native = dir.join("native.png");
        let process = dir.join("process.png");
        let started = std::time::Instant::now();
        assert!(super::extract_associated_icon_to_png(&input, &native).unwrap());
        let native_time = started.elapsed();
        let started = std::time::Instant::now();
        assert!(super::extract_shortcut_icon_to_png(&input, &process).unwrap());
        let process_time = started.elapsed();
        for path in [&native, &process] {
            let bytes = std::fs::read(path).unwrap();
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        }
        eprintln!("icon extraction: native={native_time:?}, process={process_time:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
