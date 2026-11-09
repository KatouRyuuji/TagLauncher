// ============================================================================
// lib/importContext.ts — 导入落点快照与递归导入路径规划
// ============================================================================
// 标签归属与柜归属正交：关键词 / NOT 等复杂搜索只关闭自动打标，不阻止普通柜入柜。
// 关联目录柜不把外部文件偷偷移入磁盘目录；前端据此提示，后端也不写 cabinet_items。
// 递归导入沿用 folder / contents / both：为逐级浏览补上中间目录，并把非投放根隐藏出 All。
// ============================================================================

import { isUnderDir, normalizeDir, parentDir } from "./cabinetBrowse";

function dirKey(path: string): string {
  return normalizeDir(path).toLowerCase();
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed.length === 0) continue;
    const key = dirKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeDir(trimmed) || trimmed);
  }
  return out;
}

/** 从已扫到的文件路径推出中间目录（含投放根），不再额外扫盘。 */
export function intermediateDirs(droppedFolders: string[], files: string[]): string[] {
  const roots = uniquePaths(droppedFolders);
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let dir = parentDir(file);
    while (dir.length > 0) {
      const underRoot = roots.some((root) => dirKey(dir) === dirKey(root) || isUnderDir(dir, root));
      if (!underRoot) break;
      const key = dirKey(dir);
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(normalizeDir(dir));
      }
      if (roots.some((root) => dirKey(dir) === dirKey(root))) break;
      dir = parentDir(dir);
    }
  }
  return dirs;
}

export interface ImportPlacement {
  /** 普通柜才写入；关联柜为 null */
  cabinetId: number | null;
  /** 仅简单正选时赋直接标签；复杂搜索时为空 */
  tagIds: number[];
  /** 当前正看着关联目录柜：外部文件不入该柜、不移动磁盘文件 */
  linkedCabinetBlocked: boolean;
}

export function snapshotImportPlacement(input: {
  selectedCabinetId: number | null;
  cabinets: { id: number; folder_path: string | null }[];
  selectedTagIds: number[];
  excludedTagIds: number[];
  searchQuery: string;
}): ImportPlacement {
  const cabinet = input.cabinets.find((entry) => entry.id === input.selectedCabinetId) ?? null;
  const linked = Boolean(cabinet?.folder_path);
  const applyTags =
    input.selectedTagIds.length > 0 &&
    input.excludedTagIds.length === 0 &&
    input.searchQuery.trim().length === 0;
  return {
    cabinetId: linked ? null : input.selectedCabinetId,
    tagIds: applyTags ? [...input.selectedTagIds] : [],
    linkedCabinetBlocked: linked,
  };
}

export const LINKED_CABINET_IMPORT_NOTICE =
  "关联目录柜的成员由磁盘文件夹决定，外部文件不会被移入该目录，也不会自动加入该柜。已加入对象库。";

export interface NestedImportPlan {
  paths: string[];
  hideFromAllPaths: string[];
}

/**
 * 规划一次文件夹导入要交给 add_items 的路径，以及其中应对新建记录打 hide_from_all 的路径。
 * 投放根与同批松散文件保持可见；夹内文件与中间目录默认藏出 All。
 */
export function planNestedImport(args: {
  mode: "folder" | "contents" | "both";
  droppedFolders: string[];
  droppedFiles: string[];
  expandedFiles: string[];
}): NestedImportPlan {
  const roots = uniquePaths(args.droppedFolders);
  const looseFiles = uniquePaths(args.droppedFiles);
  const expanded = uniquePaths(args.expandedFiles);

  if (args.mode === "folder") {
    return { paths: uniquePaths([...roots, ...looseFiles]), hideFromAllPaths: [] };
  }

  const dirs = intermediateDirs(roots, expanded);
  const paths = uniquePaths([...roots, ...dirs, ...expanded, ...looseFiles]);
  const keepVisible = new Set([...roots, ...looseFiles].map(dirKey));
  const hideFromAllPaths = paths.filter((path) => !keepVisible.has(dirKey(path)));
  return { paths, hideFromAllPaths };
}

export function toAddItemsContext(
  placement: ImportPlacement,
  hideFromAllPaths: string[],
): { cabinetId?: number; tagIds?: number[]; hideFromAllPaths?: string[] } {
  const context: { cabinetId?: number; tagIds?: number[]; hideFromAllPaths?: string[] } = {};
  if (placement.cabinetId != null) context.cabinetId = placement.cabinetId;
  if (placement.tagIds.length > 0) context.tagIds = placement.tagIds;
  if (hideFromAllPaths.length > 0) context.hideFromAllPaths = hideFromAllPaths;
  return context;
}
