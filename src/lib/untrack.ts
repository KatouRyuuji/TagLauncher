// ============================================================================
// lib/untrack.ts — 监视 / 关联文件夹内对象的「不再追踪」
// ============================================================================
// 位于已打开监视的文件夹或关联文件夹之下（不含该目录本身）的对象，从库中移除时
// 后端记入忽略名单，补扫不再导回；被忽略的文件夹连同其下已入库对象一并移出。
// 这里计算弹窗所需的判定与连带对象，口径与后端一致（反斜杠、大小写不敏感）。
// ============================================================================

import { isUnderDir } from "./cabinetBrowse";

/** 忽略名单变化（不再追踪 / 恢复追踪）后广播，列表与计数据此刷新 */
export const IGNORED_PATHS_CHANGED_EVENT = "taglauncher-ignored-paths-changed";

export function notifyIgnoredPathsChanged(): void {
  window.dispatchEvent(new Event(IGNORED_PATHS_CHANGED_EVENT));
}

/** 已配置的监视目录：打开了监视的文件夹对象与关联柜的文件夹 */
export function watchRootPaths(
  items: Array<{ id: number; path: string }>,
  watchedItemIds: number[],
  cabinets: Array<{ folder_path: string | null }>,
): string[] {
  const watched = new Set(watchedItemIds);
  return [
    ...items.filter((item) => watched.has(item.id)).map((item) => item.path),
    ...cabinets.flatMap((cabinet) => (cabinet.folder_path ? [cabinet.folder_path] : [])),
  ];
}

export interface UntrackPlan {
  /** 目标中位于监视目录之下的对象数 */
  untrackedCount: number;
  /** 被忽略文件夹之下、目标之外的已入库对象（随之移出库） */
  extraIds: number[];
}

export function planUntrack(
  targetIds: number[],
  items: Array<{ id: number; path: string; type: string }>,
  roots: string[],
): UntrackPlan {
  const targets = new Set(targetIds);
  const untracked = items.filter((item) => targets.has(item.id) && roots.some((root) => isUnderDir(item.path, root)));
  const folders = untracked.filter((item) => item.type === "folder").map((item) => item.path);
  const extraIds = folders.length === 0
    ? []
    : items
      .filter((item) => !targets.has(item.id) && folders.some((folder) => isUnderDir(item.path, folder)))
      .map((item) => item.id);
  return { untrackedCount: untracked.length, extraIds };
}
