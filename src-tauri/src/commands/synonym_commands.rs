use crate::services::synonym_service;
use tauri::AppHandle;

#[tauri::command]
pub fn read_synonyms(app: AppHandle) -> Result<Vec<Vec<String>>, String> {
    synonym_service::read_synonyms(&app)
}
