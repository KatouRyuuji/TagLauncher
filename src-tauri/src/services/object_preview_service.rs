use base64::{engine::general_purpose, Engine as _};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::tag::ItemKey;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// 单次目录列举返回的最大项数（超大目录只取前 N 项，防内存/IPC 膨胀）。
const MAX_DIR_ENTRIES: usize = 5000;

/// 内嵌封面 base64 的原始字节上限：超过则丢弃（预览降级为无封面），避免撑爆 IPC/内存。
const MAX_COVER_BYTES: usize = 5 * 1_048_576; // 5 MB

#[derive(Debug, Serialize)]
pub struct ObjectFileInfo {
    pub name: String,
    pub path: String,
    pub item_type: String,
    pub is_file: bool,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified_at_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ObjectDirectoryEntry {
    pub name: String,
    pub path: String,
    pub item_type: String,
    pub is_file: bool,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AudioPreviewInfo {
    pub duration_ms: Option<u64>,
    pub sample_rate: Option<u32>,
    pub encoding: Option<String>,
    pub bitrate_kbps: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_cover_data_url: Option<String>,
}

pub fn get_object_file_info(path: &str) -> Result<ObjectFileInfo, String> {
    let path_buf = PathBuf::from(path);
    let meta = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    Ok(ObjectFileInfo {
        name: display_name(&path_buf, path),
        path: path.to_string(),
        item_type: detect_preview_type(&path_buf).to_string(),
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
        size: meta.is_file().then_some(meta.len()),
        modified_at_secs: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
    })
}

pub fn list_object_directory(path: &str) -> Result<Vec<ObjectDirectoryEntry>, String> {
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err("路径不是文件夹".to_string());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        if entries.len() >= MAX_DIR_ENTRIES {
            break; // 目录项数上限：超大目录只返回前 N 项，避免内存/IPC 膨胀
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let path_buf = entry.path();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        // 跳过符号链接/重解析点（如系统 junction）：它们在列表中既非文件也非目录，
        // 点击导航无意义，且可能指向用户预期之外的系统目录
        if meta.file_type().is_symlink() {
            continue;
        }
        entries.push(ObjectDirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path_buf.to_string_lossy().to_string(),
            item_type: detect_preview_type(&path_buf).to_string(),
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
            size: meta.is_file().then_some(meta.len()),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn get_audio_preview(path: &str) -> Result<AudioPreviewInfo, String> {
    let tagged_file = lofty::read_from_path(path).map_err(|e| e.to_string())?;
    let properties = tagged_file.properties();
    let duration = properties.duration();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let album_cover_data_url = tag
        .and_then(select_cover_picture)
        .and_then(|picture| picture_data_url(picture));

    Ok(AudioPreviewInfo {
        duration_ms: (duration > Duration::ZERO).then_some(duration.as_millis() as u64),
        sample_rate: properties.sample_rate(),
        encoding: Some(audio_encoding_label(
            path,
            &format!("{:?}", tagged_file.file_type()),
        )),
        bitrate_kbps: properties
            .audio_bitrate()
            .or_else(|| properties.overall_bitrate()),
        bit_depth: properties.bit_depth(),
        channels: properties.channels(),
        title: tag.and_then(|t| t.get_string(ItemKey::TrackTitle).map(str::to_string)),
        artist: tag.and_then(|t| t.get_string(ItemKey::TrackArtist).map(str::to_string)),
        album: tag.and_then(|t| t.get_string(ItemKey::AlbumTitle).map(str::to_string)),
        album_cover_data_url,
    })
}

pub fn extract_audio_cover(path: &str) -> Result<Option<(String, Vec<u8>)>, String> {
    let tagged_file = lofty::read_from_path(path).map_err(|e| e.to_string())?;
    let picture = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .and_then(select_cover_picture);

    Ok(picture.and_then(|p| {
        let mime = p.mime_type()?.as_str().to_string();
        Some((mime, p.data().to_vec()))
    }))
}

fn select_cover_picture(tag: &lofty::tag::Tag) -> Option<&lofty::picture::Picture> {
    tag.get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
}

fn picture_data_url(picture: &lofty::picture::Picture) -> Option<String> {
    let data = picture.data();
    if data.len() > MAX_COVER_BYTES {
        return None; // 过大封面丢弃，预览降级为无封面，避免撑爆 IPC/内存
    }
    let mime = picture.mime_type()?.as_str();
    let encoded = general_purpose::STANDARD.encode(data);
    Some(format!("data:{};base64,{}", mime, encoded))
}

fn display_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(fallback)
        .to_string()
}

fn detect_preview_type(path: &Path) -> &'static str {
    if path.is_dir() {
        return "folder";
    }
    // 扩展名归类与 IMAGE_EXTS/AUDIO_EXTS 单一来源，复用 item_service（避免两处列表漂移）。
    crate::services::item_service::classify_by_extension(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
    )
}

fn audio_encoding_label(path: &str, fallback: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    match ext.as_deref() {
        Some("mp3") => "MP3".to_string(),
        Some("mp2") => "MP2".to_string(),
        Some("mp1") => "MP1".to_string(),
        Some("flac") => "FLAC".to_string(),
        Some("wav") | Some("wave") => "WAV".to_string(),
        Some("ogg") => "Ogg Vorbis".to_string(),
        Some("opus") => "Opus".to_string(),
        Some("m4a") | Some("m4b") | Some("m4p") | Some("m4r") => "MPEG-4 Audio".to_string(),
        Some("aac") => "AAC".to_string(),
        Some("aiff") | Some("aif") | Some("aifc") => "AIFF".to_string(),
        Some("ape") => "Monkey's Audio".to_string(),
        Some("wv") => "WavPack".to_string(),
        Some("mpc") | Some("mp+") | Some("mpp") => "Musepack".to_string(),
        Some("spx") => "Speex".to_string(),
        _ => fallback.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn detects_audio_extensions_without_common_video_containers() {
        assert_eq!(detect_preview_type(Path::new("track.mp3")), "audio");
        assert_eq!(detect_preview_type(Path::new("track.flac")), "audio");
        assert_eq!(detect_preview_type(Path::new("track.m4a")), "audio");
        assert_eq!(detect_preview_type(Path::new("clip.mp4")), "exe");
        assert_eq!(detect_preview_type(Path::new("clip.m4v")), "exe");
        assert_eq!(detect_preview_type(Path::new("track.wma")), "exe");
    }

    #[test]
    fn list_directory_sorts_directories_first() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("taglauncher-preview-test-{}", stamp));
        let child_dir = root.join("B-folder");
        let child_file = root.join("a-track.mp3");

        std::fs::create_dir_all(&child_dir).expect("create child dir");
        std::fs::write(&child_file, []).expect("create child file");

        let entries = list_object_directory(root.to_str().expect("temp path should be valid UTF-8"))
            .expect("list directory");

        std::fs::remove_dir_all(&root).ok();

        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "B-folder");
        assert_eq!(entries[1].item_type, "audio");
    }
}
