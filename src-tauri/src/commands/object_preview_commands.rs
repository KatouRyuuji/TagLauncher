use crate::services::object_preview_service;

// 三个命令均做同步文件 IO（目录枚举/音频解析），用 (async) 放到工作线程避免冻结 UI；
// 函数体全同步（无 await），不涉及 DB 锁。

#[tauri::command(async)]
pub fn get_object_file_info(
    path: String,
) -> Result<object_preview_service::ObjectFileInfo, String> {
    object_preview_service::get_object_file_info(&path)
}

#[tauri::command(async)]
pub fn list_object_directory(
    path: String,
) -> Result<Vec<object_preview_service::ObjectDirectoryEntry>, String> {
    object_preview_service::list_object_directory(&path)
}

#[tauri::command(async)]
pub fn get_audio_preview(path: String) -> Result<object_preview_service::AudioPreviewInfo, String> {
    object_preview_service::get_audio_preview(&path)
}
