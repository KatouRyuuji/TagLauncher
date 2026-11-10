// ============================================================================
// lib/collect.ts — 收纳（右键菜单 / 发送到）的动作规划（全局极速阶段③）
// ============================================================================
// 后端把多次调用合并成一个收纳会话（src-tauri/src/collect.rs），快速窗让用户选动作：
// 打标签 / 放入文件柜 / 仅导入。写入走与主窗拖入相同的导入语义：
// - 含文件夹时按 folder / contents / both 规划（planNestedImport），夹内文件与中间目录默认藏出总览；
// - 打标签 / 入柜由 add_items 的导入上下文在同一事务里完成（重复项只追加标签、柜归属叠加）；
// - 关联目录柜不接收外部文件（成员由磁盘文件夹决定），不出现在可选文件柜里。
// ============================================================================

import type { AddItemsContext, ImportPathClass } from "./db";
import { planNestedImport, type NestedImportPlan } from "./importContext";
import type { Cabinet, Tag } from "../types";

export const QUICK_COLLECT_EVENT = "quick-collect";
/** 与主窗导入对话框共用「上次的文件夹导入方式」 */
export const FOLDER_IMPORT_MODE_KEY = "taglauncher.folder_import_mode";

export type CollectAction = "tag" | "cabinet" | "import";
export type FolderMode = "folder" | "contents" | "both";

export interface CollectSession {
  id: number;
  paths: string[];
  invocations: number;
  invalid: number;
  truncated: boolean;
  startedMs: number;
}

export interface CollectPreference {
  action: CollectAction;
  tagIds: number[];
  cabinetId: number | null;
  folderMode: FolderMode | null;
}

export interface CollectChoice {
  action: CollectAction;
  tagIds: number[];
  cabinetId: number | null;
  folderMode: FolderMode;
}

export const FOLDER_MODE_LABELS: Record<FolderMode, string> = {
  folder: "只加文件夹本身",
  contents: "展开夹内文件（不铺满总览）",
  both: "文件夹和夹内文件（夹内不铺满总览）",
};

export function readFolderMode(storage: Pick<Storage, "getItem"> | null = safeStorage()): FolderMode {
  const value = storage?.getItem(FOLDER_IMPORT_MODE_KEY);
  return value === "contents" || value === "both" ? value : "folder";
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 可放入的文件柜：普通柜（关联目录柜由磁盘文件夹决定成员，不接收外部文件） */
export function collectableCabinets(cabinets: readonly Cabinet[]): Cabinet[] {
  return cabinets.filter((c) => !c.folder_path);
}

/** 规划要交给 add_items 的路径（与主窗 useFolderImport 同一规则） */
export function planCollect(
  classified: ImportPathClass,
  folderMode: FolderMode,
  expandedFiles: string[],
): NestedImportPlan {
  if (classified.folders.length === 0) return { paths: classified.files, hideFromAllPaths: [] };
  return planNestedImport({
    mode: folderMode,
    droppedFolders: classified.folders,
    droppedFiles: classified.files,
    expandedFiles: folderMode === "folder" ? [] : expandedFiles,
  });
}

export function collectContext(choice: CollectChoice, plan: NestedImportPlan): AddItemsContext {
  const context: AddItemsContext = {};
  if (choice.action === "tag" && choice.tagIds.length > 0) context.tagIds = [...choice.tagIds];
  if (choice.action === "cabinet" && choice.cabinetId != null) context.cabinetId = choice.cabinetId;
  if (plan.hideFromAllPaths.length > 0) context.hideFromAllPaths = plan.hideFromAllPaths;
  return context;
}

/** 记住的选择是否还能用（标签/文件柜可能已被删除，关联柜不可放入） */
export function usablePreference(
  pref: CollectPreference | null,
  tags: readonly Tag[],
  cabinets: readonly Cabinet[],
): CollectChoice | null {
  if (!pref) return null;
  const folderMode = pref.folderMode ?? readFolderMode();
  if (pref.action === "tag") {
    const known = new Set(tags.map((t) => t.id));
    const tagIds = pref.tagIds.filter((id) => known.has(id));
    return tagIds.length > 0 ? { action: "tag", tagIds, cabinetId: null, folderMode } : null;
  }
  if (pref.action === "cabinet") {
    const ok = collectableCabinets(cabinets).some((c) => c.id === pref.cabinetId);
    return ok ? { action: "cabinet", tagIds: [], cabinetId: pref.cabinetId, folderMode } : null;
  }
  return { action: "import", tagIds: [], cabinetId: null, folderMode };
}

export function describeChoice(choice: Pick<CollectChoice, "action" | "tagIds" | "cabinetId">, tags: readonly Tag[], cabinets: readonly Cabinet[]): string {
  if (choice.action === "tag") {
    const names = choice.tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean);
    return `打标签「${names.join("、") || "?"}」`;
  }
  if (choice.action === "cabinet") {
    return `放入文件柜「${cabinets.find((c) => c.id === choice.cabinetId)?.name ?? "?"}」`;
  }
  return "仅导入";
}

export function toPreference(choice: CollectChoice, hasFolders: boolean): CollectPreference {
  return {
    action: choice.action,
    tagIds: choice.action === "tag" ? [...choice.tagIds] : [],
    cabinetId: choice.action === "cabinet" ? choice.cabinetId : null,
    // 只有这次确实选过文件夹方式才记下；否则沿用主窗的「上次方式」
    folderMode: hasFolders ? choice.folderMode : null,
  };
}

export function pathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return i >= 0 ? trimmed.slice(i + 1) || trimmed : trimmed;
}
