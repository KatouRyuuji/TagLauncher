use crate::db::Database;
use crate::services::recolor_service::{self, RecolorPatch};
use tauri::State;

/// 色位写回条目（camelCase 与现有命令一致）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecolorColorPatch {
    pub id: i64,
    pub color: String,
}

/// 一次切换一条批量 IPC：标签 + 文件柜的 color 在同一 SQLite 事务里写回。
#[tauri::command]
pub fn recolor_tags_and_cabinets(
    db: State<Database>,
    tags: Vec<RecolorColorPatch>,
    cabinets: Vec<RecolorColorPatch>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let tag_patches: Vec<RecolorPatch<'_>> = tags
        .iter()
        .map(|p| RecolorPatch {
            id: p.id,
            color: p.color.as_str(),
        })
        .collect();
    let cabinet_patches: Vec<RecolorPatch<'_>> = cabinets
        .iter()
        .map(|p| RecolorPatch {
            id: p.id,
            color: p.color.as_str(),
        })
        .collect();
    recolor_service::recolor_tags_and_cabinets(&conn, &tag_patches, &cabinet_patches)
}
