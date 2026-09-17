// ============================================================================
// lib/itemActionCopy.ts — 打开 / 揭示 / 移除 的对外用词
// ============================================================================
// 磁盘文件夹、库项目、虚拟文件柜不能共用「文件夹 / 启动 / 删除」。
// 这里集中卡片、菜单、预览、确认框要用的短句，避免各处各写一套。
// ============================================================================

/** 右键「打开」：文件夹打开自身，其余打开该项目。多选写「打开 N 项」。 */
export function openMenuLabel(itemType: string, count = 1): string {
  if (count > 1) return `打开 ${count} 项`;
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

/** 批量条指挥台：出库 ≠ 删盘，避免全选后把描边危险键读成删文件。 */
export const libraryRemoveNotDeleteHint = "从库中移除 ≠ 删除本地文件";

/** 默认入口（右键「从库中移除」）的确认框标题：移出资料库 ≠ 删盘。 */
export function removeFromLibraryDialogTitle(count: number): string {
  return count > 1 ? `移出资料库 ${count} 项` : "移出资料库";
}

/** 从菜单「删除本地文件」进来时的确认框标题。 */
export function deleteFilesDialogTitle(count: number): string {
  return count > 1 ? `删除本地文件 ${count} 项` : "删除本地文件";
}

/** 确认框预览列表里标出文件夹，避免和文件扫成一类。 */
export const folderTypeBadge = "文件夹";

/** 失效找回：这次一张都没找回。 */
export function relocateNoneCopy(): string {
  return "这次没有找回任何项目。请确认磁盘已连接；文件回来后会自动重新关联。";
}

/** 失效找回：已找回 N 项。 */
export function relocateRecoveredCopy(recovered: number): string {
  return `已找回 ${recovered} 项`;
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
