import { useAppStore } from "../stores/appStore";

/** 单选打开已有条目标签编辑；多选打开批量「加入标签」（追加，不覆写原标签）。 */
export function requestEditItemTags(selectedItemIds: number[]): boolean {
  if (selectedItemIds.length > 1) {
    useAppStore.getState().setTagEditorItemId(null);
    useAppStore.getState().setBatchAddTagOpen(true);
    return true;
  }
  const id = selectedItemIds[0];
  if (id == null) return false;
  useAppStore.getState().setBatchAddTagOpen(false);
  useAppStore.getState().setTagEditorItemId(id);
  return true;
}
