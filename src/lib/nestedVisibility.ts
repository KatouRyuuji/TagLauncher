// ============================================================================
// lib/nestedVisibility.ts — All 总览隐藏目录内文件的真值与库内逐级浏览
// ============================================================================
// hide_from_all 只约束「全部项目」默认列表，不是全局抹除：搜索、标签筛选、柜、
// 收藏、最近使用、库内目录浏览都能看到这些对象。关切换不丢库内数据。
// ============================================================================

import { currentBrowseDir, isUnderDir, normalizeDir, parentDir } from "./cabinetBrowse";

export function isHiddenFromAll<T extends { hide_from_all?: boolean }>(item: T): boolean {
  return item.hide_from_all === true;
}

export function shouldRevealNested(input: {
  showNestedContents: boolean;
  hasSearchQuery: boolean;
  selectedTagIds: readonly number[];
  excludedTagIds: readonly number[];
  selectedCabinetId: number | null;
  showFavorites: boolean;
  showRecent: boolean;
  libraryBrowseRoot: string | null;
}): boolean {
  return (
    input.showNestedContents ||
    input.hasSearchQuery ||
    input.selectedTagIds.length > 0 ||
    input.excludedTagIds.length > 0 ||
    input.selectedCabinetId !== null ||
    input.showFavorites ||
    input.showRecent ||
    input.libraryBrowseRoot !== null
  );
}

export function applyNestedVisibility<T extends { hide_from_all?: boolean }>(
  items: T[],
  reveal: boolean,
): T[] {
  if (reveal) return items;
  return items.filter((item) => !isHiddenFromAll(item));
}

export function libraryBrowseDirOf(
  root: string | null,
  dir: string | null,
  opts: { hasSearchQuery: boolean; selectedTagIds: readonly number[]; excludedTagIds: readonly number[] },
): string | null {
  if (root === null) return null;
  if (opts.hasSearchQuery || opts.selectedTagIds.length > 0 || opts.excludedTagIds.length > 0) {
    return null;
  }
  return currentBrowseDir(root, dir);
}

export function hasLibraryDescendants(
  folderPath: string,
  items: readonly { id: number; path: string }[],
  folderId?: number,
): boolean {
  return items.some(
    (item) => (folderId === undefined || item.id !== folderId) && isUnderDir(item.path, folderPath),
  );
}

/** 打开隐藏对象或夹内文件时，落到最近的可见文件夹根，便于面包屑逐级返回。 */
export function nearestBrowseRoot(
  path: string,
  items: readonly { path: string; type: string; hide_from_all?: boolean }[],
): string {
  const folders = items.filter((item) => item.type === "folder");
  const visible = folders.filter((item) => !isHiddenFromAll(item));
  let best: string | null = null;
  for (const folder of visible) {
    if (dirEquals(folder.path, path) || isUnderDir(path, folder.path)) {
      if (best === null || normalizeDir(folder.path).length > normalizeDir(best).length) {
        best = folder.path;
      }
    }
  }
  if (best) return normalizeDir(best);
  for (const folder of folders) {
    if (dirEquals(folder.path, path) || isUnderDir(path, folder.path)) {
      if (best === null || normalizeDir(folder.path).length > normalizeDir(best).length) {
        best = folder.path;
      }
    }
  }
  if (best) return normalizeDir(best);
  const parent = parentDir(path);
  return parent.length > 0 ? parent : normalizeDir(path);
}

export function browseTargetForItem(
  item: { path: string; type: string; hide_from_all?: boolean; id: number; is_missing?: boolean },
  allItems: readonly { id: number; path: string; type: string; hide_from_all?: boolean }[],
): { root: string; dir: string | null } | null {
  if (item.is_missing) return null;
  if (item.type === "folder" && hasLibraryDescendants(item.path, allItems, item.id)) {
    return { root: normalizeDir(item.path), dir: null };
  }
  if (isHiddenFromAll(item)) {
    const root = nearestBrowseRoot(item.path, allItems);
    const dir = item.type === "folder" ? normalizeDir(item.path) : parentDir(item.path);
    return { root, dir: dir.length > 0 ? dir : null };
  }
  return null;
}

function dirEquals(a: string, b: string): boolean {
  return normalizeDir(a).toLowerCase() === normalizeDir(b).toLowerCase();
}
