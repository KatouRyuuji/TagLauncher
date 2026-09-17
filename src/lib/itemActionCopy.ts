// ============================================================================
// lib/itemActionCopy.ts — 打开 / 揭示 / 移除 的对外用词
// ============================================================================
// 磁盘文件夹、库项目、虚拟文件柜不能共用「文件夹 / 启动 / 删除」。
// 这里集中卡片、菜单、预览、确认框要用的短句，避免各处各写一套。
// ============================================================================

/** 右键「打开」：文件夹打开自身，其余打开该项目。 */
export function openMenuLabel(itemType: string): string {
  return itemType === "folder" ? "打开此文件夹" : "打开";
}

/** 右键揭示位置：文件夹打开上一级，文件打开所在目录。 */
export function revealMenuLabel(itemType: string): string {
  return itemType === "folder" ? "打开上一级" : "打开所在文件夹";
}

export function revealFailedToast(itemType: string): string {
  return itemType === "folder" ? "打开上一级失败" : "打开所在文件夹失败";
}

/** 卡片/预览主按钮：可执行文件仍说启动，其余说打开。 */
export function cardOpenLabel(itemType: string): string {
  return itemType === "exe" || itemType === "bat" || itemType === "ps1" ? "启动" : "打开";
}

export function libraryRemoveLabel(count: number): string {
  return count > 1 ? `仅出库 ${count} 项` : "仅出库";
}

export function deleteFilesLabel(count: number): string {
  return count > 1 ? `删除 ${count} 个本地文件` : "删除本地文件";
}

export function parentDirectoryPath(path: string): string | null {
  const normalized = path.replace(/[/\\]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (slash <= 0) return null;
  return normalized.slice(0, slash);
}

export function pathBasename(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}
