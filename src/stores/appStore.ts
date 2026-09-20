// ============================================================================
// stores/appStore.ts — Zustand 全局状态管理
// ============================================================================
// 使用 Zustand 管理应用的全局状态，包括数据缓存、筛选条件和 UI 状态。
// 核心设计：标签筛选、文件柜筛选、收藏夹、最近使用 四种模式互斥。
// 视图偏好（视图/搜索模式/排序/类型筛选/筛选条展开）持久化到 localStorage。
// ============================================================================

import { create } from "zustand";
import type { Tag, Cabinet, TagRelation } from "../types";
import * as db from "../lib/db";
import {
  isSortMode,
  isTypeFilter,
  isViewMode,
  type SortMode,
  type TypeFilter,
  type ViewMode,
} from "../lib/itemQuery";
import {
  applyCardSizeVars,
  clampSizeScale,
  CARD_SIZE_SCALE_RANGE,
  ICON_SIZE_SCALE_RANGE,
} from "../lib/cardSizeVars";
import { SEARCH_RESET_EVENT } from "../lib/workspaceChrome";

function sameTags(a: Tag[], b: Tag[]): boolean {
  return a.length === b.length && a.every((tag, index) =>
    tag.id === b[index].id &&
    tag.name === b[index].name &&
    tag.color === b[index].color,
  );
}

function sameRelations(a: TagRelation[], b: TagRelation[]): boolean {
  return a.length === b.length && a.every((rel, index) =>
    rel.parentId === b[index].parentId && rel.childId === b[index].childId,
  );
}

function sameCabinets(a: Cabinet[], b: Cabinet[]): boolean {
  return a.length === b.length && a.every((cabinet, index) =>
    cabinet.id === b[index].id &&
    cabinet.name === b[index].name &&
    cabinet.color === b[index].color &&
    cabinet.created_at === b[index].created_at,
  );
}

function sameNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 搜索模式：全部 / 仅名称路径 / 仅标签 */
export type SearchMode = "all" | "name" | "tag";

/** 侧边栏页签：标签 / 文件柜 */
export type SidebarTab = "tags" | "cabinets";

export type { SortMode, TypeFilter, ViewMode };

const PREFS_KEY = "taglauncher.workspace_prefs";
const SIDEBAR_HINT_DISMISSED_KEY = "taglauncher.sidebar_hint_dismissed";

function loadSidebarHintDismissed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistSidebarHintDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      localStorage.setItem(SIDEBAR_HINT_DISMISSED_KEY, "1");
    } else {
      localStorage.removeItem(SIDEBAR_HINT_DISMISSED_KEY);
    }
  } catch {
    // 隐私模式或配额不足时忽略
  }
}

/** 侧栏拖拽教程展示次数上限：达到后自动收起，把侧栏底部还给内容 */
const SIDEBAR_HINT_SEEN_KEY = "taglauncher.sidebar_hint_seen";
const SIDEBAR_HINT_AUTO_DISMISS_AFTER = 6;

function countSidebarHintSeenAndAutoDismiss(): void {
  try {
    if (localStorage.getItem(SIDEBAR_HINT_DISMISSED_KEY) === "1") return;
    const seen = Number(localStorage.getItem(SIDEBAR_HINT_SEEN_KEY) ?? "0") + 1;
    localStorage.setItem(SIDEBAR_HINT_SEEN_KEY, String(seen));
    if (seen >= SIDEBAR_HINT_AUTO_DISMISS_AFTER) persistSidebarHintDismissed(true);
  } catch {
    // 隐私模式或配额不足时忽略
  }
}

interface WorkspacePrefs {
  viewMode?: ViewMode;
  searchMode?: SearchMode;
  sortMode?: SortMode;
  typeFilter?: TypeFilter;
  workspaceFiltersOpen?: boolean;
  cardSizeScale?: number;
  iconSizeScale?: number;
}

/** 读取持久化的缩放值：非法值丢弃（回退默认 1），合法值夹取到允许范围 */
function loadSizeScale(raw: unknown, range: { min: number; max: number }): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return clampSizeScale(raw, range);
}

function loadWorkspacePrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : undefined,
      searchMode: parsed.searchMode === "all" || parsed.searchMode === "name" || parsed.searchMode === "tag"
        ? parsed.searchMode
        : undefined,
      sortMode: isSortMode(parsed.sortMode) ? parsed.sortMode : undefined,
      typeFilter: isTypeFilter(parsed.typeFilter) ? parsed.typeFilter : undefined,
      workspaceFiltersOpen: typeof parsed.workspaceFiltersOpen === "boolean"
        ? parsed.workspaceFiltersOpen
        : undefined,
      cardSizeScale: loadSizeScale(parsed.cardSizeScale, CARD_SIZE_SCALE_RANGE),
      iconSizeScale: loadSizeScale(parsed.iconSizeScale, ICON_SIZE_SCALE_RANGE),
    };
  } catch {
    return {};
  }
}

function persistWorkspacePrefs(prefs: Required<WorkspacePrefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式或配额不足时忽略
  }
}

const initialPrefs = loadWorkspacePrefs();

// 启动即应用持久化的尺寸缩放，避免首帧按默认尺寸渲染后再跳变
applyCardSizeVars(initialPrefs.cardSizeScale ?? 1, initialPrefs.iconSizeScale ?? 1);

// 侧栏拖拽教程计次：超过上限自动收起（须在读初始状态前执行）
countSidebarHintSeenAndAutoDismiss();

/** 阻断式重启遮罩状态（数据目录切换 / 导入 / 云端恢复成功后激活） */
export interface RestartOverlayState {
  /** 操作结果说明（如"数据目录已切换"） */
  message: string;
  /** 自动重启失败：转为提示用户手动重启，不再放回主界面 */
  restartFailed: boolean;
}

interface AppState {
  // ---- 数据缓存 ----
  tags: Tag[];
  tagRelations: TagRelation[];
  cabinets: Cabinet[];

  // ---- 筛选状态（四者互斥） ----
  /** 正选标签：结果须同时包含全部已选标签（AND） */
  selectedTagIds: number[];
  /** 反选标签：结果排除包含任一已反选标签的对象；与正选不重叠 */
  excludedTagIds: number[];
  selectedCabinetId: number | null;
  showFavorites: boolean;
  showRecent: boolean;

  // ---- UI 状态 ----
  sidebarTab: SidebarTab;
  searchQuery: string;
  /**
   * 搜索框中的即时输入值（未经防抖）。与 searchQuery 不一致时表示
   * 防抖窗口内还有待生效的搜索输入，StatusBar 据此显示"搜索中"指示。
   */
  searchInputValue: string;
  searchMode: SearchMode;
  viewMode: ViewMode;
  sortMode: SortMode;
  typeFilter: TypeFilter;
  /** 卡片视图尺寸缩放（1 = 默认 256px 列宽） */
  cardSizeScale: number;
  /** 大图标视图尺寸缩放（1 = 默认 168px 列宽） */
  iconSizeScale: number;
  /** 主界面「筛选」条是否展开（类型/搜索范围）；有生效筛选时 SearchBar 仍会显示该条 */
  workspaceFiltersOpen: boolean;
  /** 侧栏拖拽教程已关闭（持久化）；拖拽进行中的释放提示仍会显示 */
  sidebarHintDismissed: boolean;
  tagGraphOpen: boolean;
  commandPaletteOpen: boolean;
  shortcutsHelpOpen: boolean;
  previewItemId: number | null;
  /** 状态栏 / 右键 / 命令面板共用的失效项目复核弹窗 */
  missingReviewOpen: boolean;
  /**
   * 阻断式重启遮罩：切换数据目录 / 导入数据 / 云端恢复成功后激活。
   * 这些操作后旧库写入已冻结、重启才生效，遮罩阻断一切交互并自动重启，
   * 避免 1.x 秒窗口内用户的操作被静默丢弃。
   */
  restartOverlay: RestartOverlayState | null;

  // ---- Actions ----
  setTags: (tags: Tag[]) => void;
  setTagRelations: (relations: TagRelation[]) => void;
  setCabinets: (cabinets: Cabinet[]) => void;
  setSelectedTagIds: (ids: number[]) => void;
  toggleTagSelection: (id: number) => void;
  /** 右键标签的反选切换：反选与正选互斥，加入反选时从正选移除 */
  toggleTagExclusion: (id: number) => void;
  setSelectedCabinetId: (id: number | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowFavorites: (v: boolean) => void;
  setShowRecent: (v: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchInputValue: (value: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortMode: (mode: SortMode) => void;
  setTypeFilter: (filter: TypeFilter) => void;
  setCardSizeScale: (scale: number) => void;
  setIconSizeScale: (scale: number) => void;
  setWorkspaceFiltersOpen: (open: boolean) => void;
  setSidebarHintDismissed: (dismissed: boolean) => void;
  setTagGraphOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setPreviewItemId: (id: number | null) => void;
  setMissingReviewOpen: (open: boolean) => void;
  /** 激活重启遮罩并自动重启；重启失败时遮罩转为"请手动重启" */
  beginRestart: (message: string) => void;
  clearWorkspaceFilters: () => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const persistNow = () => {
    const state = get();
    persistWorkspacePrefs({
      viewMode: state.viewMode,
      searchMode: state.searchMode,
      sortMode: state.sortMode,
      typeFilter: state.typeFilter,
      workspaceFiltersOpen: state.workspaceFiltersOpen,
      cardSizeScale: state.cardSizeScale,
      iconSizeScale: state.iconSizeScale,
    });
  };

  return {
  tags: [],
  tagRelations: [],
  cabinets: [],
  selectedTagIds: [],
  excludedTagIds: [],
  selectedCabinetId: null,
  sidebarTab: "tags",
  showFavorites: false,
  showRecent: false,
  searchQuery: "",
  searchInputValue: "",
  searchMode: initialPrefs.searchMode ?? "all",
  viewMode: initialPrefs.viewMode ?? "grid",
  sortMode: initialPrefs.sortMode ?? "smart",
  typeFilter: initialPrefs.typeFilter ?? "all",
  cardSizeScale: initialPrefs.cardSizeScale ?? 1,
  iconSizeScale: initialPrefs.iconSizeScale ?? 1,
  workspaceFiltersOpen: initialPrefs.workspaceFiltersOpen ?? true,
  sidebarHintDismissed: loadSidebarHintDismissed(),
  tagGraphOpen: false,
  commandPaletteOpen: false,
  shortcutsHelpOpen: false,
  previewItemId: null,
  missingReviewOpen: false,
  restartOverlay: null,

  setTags: (tags) => set((state) => sameTags(state.tags, tags) ? state : { tags }),
  setTagRelations: (relations) => set((state) => sameRelations(state.tagRelations, relations) ? state : { tagRelations: relations }),
  setCabinets: (cabinets) => set((state) => sameCabinets(state.cabinets, cabinets) ? state : { cabinets }),
  setSelectedTagIds: (ids) => set((state) => {
    // 空列表 = 回到「全部标签」，正选反选一起清空；非空时剔除与反选的重叠，维持互斥
    const nextExcluded = ids.length === 0
      ? []
      : state.excludedTagIds.filter((id) => !ids.includes(id));
    const unchanged = sameNumberArray(state.selectedTagIds, ids) &&
      sameNumberArray(state.excludedTagIds, nextExcluded) &&
      state.selectedCabinetId === null &&
      !state.showFavorites &&
      !state.showRecent;
    return unchanged
      ? state
      : { selectedTagIds: ids, excludedTagIds: nextExcluded, selectedCabinetId: null, showFavorites: false, showRecent: false };
  }),

  toggleTagSelection: (id) =>
    set((state) => ({
      selectedTagIds: state.selectedTagIds.includes(id)
        ? state.selectedTagIds.filter((i) => i !== id)
        : [...state.selectedTagIds, id],
      // 正选与反选互斥：点选即撤销该标签的反选
      excludedTagIds: state.excludedTagIds.filter((i) => i !== id),
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
    })),

  toggleTagExclusion: (id) =>
    set((state) => ({
      excludedTagIds: state.excludedTagIds.includes(id)
        ? state.excludedTagIds.filter((i) => i !== id)
        : [...state.excludedTagIds, id],
      // 反选与正选互斥：加入反选时从正选移除
      selectedTagIds: state.selectedTagIds.filter((i) => i !== id),
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
    })),

  setSelectedCabinetId: (id) => set((state) =>
    state.selectedCabinetId === id &&
    state.selectedTagIds.length === 0 &&
    state.excludedTagIds.length === 0 &&
    !state.showFavorites &&
    !state.showRecent
      ? state
      : { selectedCabinetId: id, selectedTagIds: [], excludedTagIds: [], showFavorites: false, showRecent: false },
  ),

  setSidebarTab: (tab) =>
    set((state) => (state.sidebarTab === tab ? state : { sidebarTab: tab })),

  setShowFavorites: (v) => set((state) =>
    state.showFavorites === v &&
    state.selectedCabinetId === null &&
    state.selectedTagIds.length === 0 &&
    state.excludedTagIds.length === 0 &&
    !state.showRecent
      ? state
      : { showFavorites: v, selectedCabinetId: null, selectedTagIds: [], excludedTagIds: [], showRecent: false },
  ),

  setShowRecent: (v) => set((state) =>
    state.showRecent === v &&
    state.selectedCabinetId === null &&
    state.selectedTagIds.length === 0 &&
    state.excludedTagIds.length === 0 &&
    !state.showFavorites
      ? state
      : { showRecent: v, selectedCabinetId: null, selectedTagIds: [], excludedTagIds: [], showFavorites: false },
  ),

  // 直接设置搜索词（跳过防抖）时同步即时输入值，保证"防抖待生效"指示不会误亮。
  // 防抖路径（useSearch）会先单独写 searchInputValue，等定时器到期再走这里收敛。
  setSearchQuery: (query) => set((state) =>
    state.searchQuery === query && state.searchInputValue === query
      ? state
      : { searchQuery: query, searchInputValue: query },
  ),
  setSearchInputValue: (value) => set((state) => state.searchInputValue === value ? state : { searchInputValue: value }),
  setSearchMode: (mode) => {
    if (get().searchMode === mode) return;
    set({ searchMode: mode });
    persistNow();
  },
  setViewMode: (mode) => {
    if (get().viewMode === mode) return;
    set({ viewMode: mode });
    persistNow();
  },
  setSortMode: (mode) => {
    if (get().sortMode === mode) return;
    set({ sortMode: mode });
    persistNow();
  },
  setTypeFilter: (filter) => {
    if (get().typeFilter === filter) return;
    set({ typeFilter: filter });
    persistNow();
  },
  setCardSizeScale: (scale) => {
    const next = clampSizeScale(scale, CARD_SIZE_SCALE_RANGE);
    if (get().cardSizeScale === next) return;
    set({ cardSizeScale: next });
    // 同步写 CSS 变量：ItemGrid 的列数重算 effect 运行于本次渲染之后，读取的已是新值
    applyCardSizeVars(next, get().iconSizeScale);
    persistNow();
  },
  setIconSizeScale: (scale) => {
    const next = clampSizeScale(scale, ICON_SIZE_SCALE_RANGE);
    if (get().iconSizeScale === next) return;
    set({ iconSizeScale: next });
    applyCardSizeVars(get().cardSizeScale, next);
    persistNow();
  },
  setWorkspaceFiltersOpen: (open) => {
    if (get().workspaceFiltersOpen === open) return;
    set({ workspaceFiltersOpen: open });
    persistNow();
  },
  setSidebarHintDismissed: (dismissed) => {
    if (get().sidebarHintDismissed === dismissed) return;
    set({ sidebarHintDismissed: dismissed });
    persistSidebarHintDismissed(dismissed);
  },
  setTagGraphOpen: (open) => set((state) => state.tagGraphOpen === open ? state : { tagGraphOpen: open }),
  setCommandPaletteOpen: (open) => set((state) => state.commandPaletteOpen === open ? state : { commandPaletteOpen: open }),
  setShortcutsHelpOpen: (open) => set((state) => state.shortcutsHelpOpen === open ? state : { shortcutsHelpOpen: open }),
  setPreviewItemId: (id) => set((state) => state.previewItemId === id ? state : { previewItemId: id }),
  setMissingReviewOpen: (open) => set((state) => state.missingReviewOpen === open ? state : { missingReviewOpen: open }),
  beginRestart: (message) => {
    set({ restartOverlay: { message, restartFailed: false } });
    // 自动重启；失败时遮罩切换为"请手动重启"，不再放回主界面
    //（后端写入已冻结，放回主界面只会让用户操作被静默丢弃）
    void db.restartApp().catch(() =>
      set((state) =>
        state.restartOverlay
          ? { restartOverlay: { ...state.restartOverlay, restartFailed: true } }
          : state,
      ),
    );
  },
  clearWorkspaceFilters: () => {
    set({
      selectedTagIds: [],
      excludedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
      typeFilter: "all",
      searchMode: "all",
      searchQuery: "",
      searchInputValue: "",
    });
    persistNow();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SEARCH_RESET_EVENT));
    }
  },
  };
});
