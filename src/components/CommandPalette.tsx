import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp,
  Clock3,
  Command,
  FilePlus2,
  Filter,
  FolderPlus,
  Grid3X3,
  Images,
  Info,
  Keyboard,
  List,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Tags,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { pickFilesToAdd, pickFoldersToAdd } from "../lib/importDialogs";
import { filterCommandsByQuery, isImeKeyboardEvent, SORT_OPTIONS, TYPE_FILTERS, nextTypeFilter, applyTypeFilter } from "../lib/itemQuery";
import { buildSearchIndex, filterItemsByTags, searchWithIndex } from "../lib/search";
import { ensurePinyin } from "../lib/pinyinProvider";
import { buildDescendantsMap } from "../lib/tagGraph";
import { getCabinetItems } from "../lib/db";
import { onCabinetItemsChanged } from "../lib/modApi";
import { focusWorkspaceSearch, resetWorkspaceSearchInput } from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import { getTypeLabel, truncatePathMiddle } from "../lib/itemUtils";
import type { ItemWithTags } from "../types";

const PALETTE_PRIMARY = new Set([
  "search",
  "grid",
  "icons",
  "list",
  "favorites",
  "recent",
  "clear",
  "missing-review",
  "add-files",
  "add-folders",
  "settings",
  "shortcuts",
]);

interface CommandDef {
  id: string;
  title: string;
  hint?: string;
  keywords: string;
  icon: LucideIcon;
  run: () => void;
}

interface CommandPaletteProps {
  items: ItemWithTags[];
  onLaunch: (id: number) => void;
  onAddItems: (paths: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export function CommandPalette({
  items,
  onLaunch,
  onAddItems,
  onRefresh,
  onOpenSettings,
  onOpenAbout,
}: CommandPaletteProps) {
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const setShowFavorites = useAppStore((state) => state.setShowFavorites);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const setShowRecent = useAppStore((state) => state.setShowRecent);
  const showRecent = useAppStore((state) => state.showRecent);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTagGraphOpen = useAppStore((state) => state.setTagGraphOpen);
  const setShortcutsHelpOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const clearWorkspaceFilters = useAppStore((state) => state.clearWorkspaceFilters);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const tagRelations = useAppStore((state) => state.tagRelations);

  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 最近一次调度的词：挂在 pinyin 分片上的 .then 可能晚于 Esc 清空/面板重开到达，
  // 写回前比对，防止旧词复活（与工作台搜索同一守卫）
  const lastScheduledRef = useRef("");
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, autoFocus: false });

  const [cabinetItemIds, setCabinetItemIds] = useState<Set<number> | null>(null);

  // 命令面板的对象候选跟随工作台筛选：选中文件柜时先拉取柜内对象 id 集做收窄。
  // 新柜数据到达前先收窄为空，避免闪现上一个柜（或全量）的内容（与 useItems 的归属判定同理）。
  // 面板打开期间柜成员增删经 onCabinetItemsChanged 即时同步。
  useEffect(() => {
    if (!open || selectedCabinetId === null) {
      setCabinetItemIds(null);
      return;
    }
    let cancelled = false;
    setCabinetItemIds(new Set());
    void getCabinetItems(selectedCabinetId, false)
      .then((cabinetItems) => {
        if (!cancelled) setCabinetItemIds(new Set(cabinetItems.map((item) => item.id)));
      })
      .catch(() => {
        if (!cancelled) setCabinetItemIds(null);
      });
    const unsubscribe = onCabinetItemsChanged((cabinetId, itemIds) => {
      if (!cancelled && cabinetId === selectedCabinetId) {
        setCabinetItemIds(new Set(itemIds));
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open, selectedCabinetId]);

  // 对象候选收窄与工作台 useItems 同一口径：收藏 > 最近使用 > 文件柜 > 全量，
  // 再按选中标签（含后代闭包）与类型筛选过滤。
  const descendantsMap = useMemo(() => buildDescendantsMap(tagRelations), [tagRelations]);
  const scopedItems = useMemo(() => {
    let base = items;
    if (showFavorites) {
      base = items.filter((item) => item.is_favorite);
    } else if (showRecent) {
      base = items.filter((item) => Boolean(item.last_used_at));
    } else if (selectedCabinetId !== null) {
      base = cabinetItemIds ? items.filter((item) => cabinetItemIds.has(item.id)) : [];
    }
    const tagScoped = filterItemsByTags(base, selectedTagIds, (id) => descendantsMap.get(id) ?? new Set([id]), excludedTagIds);
    return applyTypeFilter(tagScoped, typeFilter);
  }, [items, showFavorites, showRecent, selectedCabinetId, cabinetItemIds, selectedTagIds, excludedTagIds, descendantsMap, typeFilter]);

  const commands = useMemo<CommandDef[]>(() => [
    { id: "search", title: "聚焦搜索", hint: "/", keywords: "search 搜索 find", icon: Search, run: () => focusWorkspaceSearch() },
    { id: "grid", title: "网格视图", hint: "G", keywords: "grid 网格", icon: Grid3X3, run: () => setViewMode("grid") },
    { id: "icons", title: "大图标视图", hint: "I", keywords: "icons 大图标 封面", icon: Images, run: () => setViewMode("icons") },
    { id: "list", title: "列表视图", hint: "L", keywords: "list 列表", icon: List, run: () => setViewMode("list") },
    { id: "favorites", title: showFavorites ? "退出收藏夹" : "打开收藏夹", keywords: "favorite 收藏 星标", icon: Star, run: () => setShowFavorites(!showFavorites) },
    { id: "recent", title: showRecent ? "退出最近使用" : "最近使用", keywords: "recent 最近 历史", icon: Clock3, run: () => setShowRecent(!showRecent) },
    { id: "clear", title: "清空筛选", keywords: "clear 重置 筛选", icon: RotateCcw, run: () => { clearWorkspaceFilters(); resetWorkspaceSearchInput(); } },
    { id: "missing-review", title: "查看失效项目", keywords: "missing 失效 丢失 找回", icon: TriangleAlert, run: () => useAppStore.getState().setMissingReviewOpen(true) },
    ...SORT_OPTIONS.map((option) => ({
      id: `sort-${option.value}`,
      title: `排序：${option.label}`,
      keywords: `sort 排序 ${option.label} ${option.value}`,
      icon: ArrowDownUp,
      run: () => setSortMode(option.value),
    })),
    ...TYPE_FILTERS.map((filter) => ({
      id: `type-${filter.value}`,
      title: filter.value === "all" ? "取消类型筛选" : `筛选${filter.label}`,
      keywords: `filter 类型 ${filter.label} ${filter.value}`,
      icon: Filter,
      run: () => setTypeFilter(nextTypeFilter(typeFilter, filter.value)),
    })),
    { id: "add-files", title: "添加文件", keywords: "import 导入 添加 文件", icon: FilePlus2, run: () => { void pickFilesToAdd().then((paths) => { if (paths) void onAddItems(paths); }); } },
    { id: "add-folders", title: "添加文件夹", keywords: "import 导入 添加 文件夹", icon: FolderPlus, run: () => { void pickFoldersToAdd().then((paths) => { if (paths) void onAddItems(paths); }); } },
    { id: "refresh", title: "刷新", keywords: "refresh 刷新 reload", icon: RefreshCw, run: () => { void onRefresh(); } },
    { id: "settings", title: "打开设置", hint: "Ctrl+,", keywords: "settings 设置 偏好", icon: Settings2, run: onOpenSettings },
    { id: "graph", title: "打开标签图谱", keywords: "graph 图谱 关系", icon: Tags, run: () => setTagGraphOpen(true) },
    { id: "shortcuts", title: "快捷键一览", hint: "?", keywords: "shortcut 快捷键 help", icon: Keyboard, run: () => setShortcutsHelpOpen(true) },
    { id: "about", title: "关于 TagLauncher", keywords: "about 关于 欢迎", icon: Info, run: onOpenAbout },
  ], [
    clearWorkspaceFilters,
    onAddItems,
    onOpenAbout,
    onOpenSettings,
    onRefresh,
    setShowFavorites,
    setShowRecent,
    showFavorites,
    showRecent,
    setSortMode,
    setTagGraphOpen,
    setTypeFilter,
    typeFilter,
    setShortcutsHelpOpen,
    setViewMode,
  ]);

  const matchedCommands = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return commands.filter((command) => PALETTE_PRIMARY.has(command.id));
    return filterCommandsByQuery(commands, q);
  }, [commands, filterQuery]);
  // 对象候选搜索固定用「全部」模式（名称+标签均可命中），不跟随工作台的「仅标签」类模式，
  // 否则切到「仅标签」后在面板里输对象名命中不了对象。
  // ≥2 字符才建索引并起搜：单字符（尤其单 CJK 字）扫全库既贵又不出有效候选
  const itemSearchQuery = filterQuery.trim().length >= 2 ? filterQuery.trim() : "";
  const searchIndex = useMemo(
    () => (open && itemSearchQuery ? buildSearchIndex(scopedItems, "all") : { entries: [], mode: "all" as const }),
    [open, scopedItems, itemSearchQuery],
  );
  const matchedItems = useMemo(() => {
    if (!itemSearchQuery) return [];
    return searchWithIndex(searchIndex, itemSearchQuery).slice(0, 8);
  }, [searchIndex, itemSearchQuery]);

  type Row = { kind: "command"; command: CommandDef } | { kind: "item"; item: ItemWithTags };
  const rows = useMemo<Row[]>(() => {
    const next: Row[] = matchedCommands.map((command) => ({ kind: "command", command }));
    for (const entry of matchedItems) next.push({ kind: "item", item: entry });
    return next;
  }, [matchedCommands, matchedItems]);

  useEffect(() => {
    if (!open) return;
    composingRef.current = false;
    setQuery("");
    setFilterQuery("");
    setActive(0);
    lastScheduledRef.current = "";
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const scheduleFilterQuery = (value: string) => {
    lastScheduledRef.current = value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value === "") {
      setFilterQuery("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      // pinyin-pro 懒加载：与工作台搜索同一门控（防抖窗口覆盖分片拉取）
      void ensurePinyin().then(() => {
        if (lastScheduledRef.current !== value) return;
        setFilterQuery(value);
      }).catch(() => {
        // 分片加载失败（pinyinProvider 已重置、下次输入重试）：本次过滤不生效
      });
    }, 150);
  };

  useEffect(() => {
    setActive(0);
  }, [filterQuery]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector("[data-active-row]");
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, rows]);

  // Esc 两级：有查询词先清空（再按才关面板），无词直接关
  useEscapeKey(() => {
    if (query) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      lastScheduledRef.current = "";
      setQuery("");
      setFilterQuery("");
      return;
    }
    setOpen(false);
  }, open);

  if (!open) return null;

  const safeActive = rows.length === 0 ? 0 : Math.min(active, rows.length - 1);

  const runRow = (row: Row | undefined) => {
    if (!row) return;
    setOpen(false);
    if (row.kind === "command") {
      row.command.run();
      return;
    }
    onLaunch(row.item.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKeyboardEvent(event)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((current) => (Math.min(current, rows.length - 1) + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((current) => (Math.min(current, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runRow(rows[safeActive]);
    } else if (event.key === "Tab") {
      const row = rows[safeActive];
      if (row?.kind === "item") {
        event.preventDefault();
        setOpen(false);
        setPreviewItemId(row.item.id);
      }
    }
  };

  return createPortal(
    <div
      data-command-palette=""
      data-workspace-overlay=""
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      className="fixed inset-0 flex items-start justify-center px-3 pt-[10vh] sm:px-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-command-palette)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={trapRef}
        className="modal-surface flex w-full max-w-[620px] flex-col overflow-hidden shadow-[var(--shadow-dropdown)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--line-hairline)] px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
            <Command aria-hidden="true" size={17} strokeWidth={1.8} />
          </div>
          <Search aria-hidden="true" size={17} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setQuery(value);
              scheduleFilterQuery(value);
            }}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (composingRef.current) return;
              scheduleFilterQuery(value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedCabinetId !== null || selectedTagIds.length > 0 || excludedTagIds.length > 0 || showFavorites || showRecent || typeFilter !== "all"
                ? "在当前筛选范围内搜索命令或项目…"
                : "搜索命令或项目…"
            }
            aria-label="搜索命令或项目"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text-primary)] placeholder-[var(--text-placeholder)] outline-none"
          />
          <button
            type="button"
            className="icon-button shrink-0"
            title="关闭命令面板"
            aria-label="关闭命令面板"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex items-center justify-between border-b border-[var(--line-hairline)] bg-[var(--surface-recessed)] px-4 py-2">
          <span className="instrument-label">命令 / 项目</span>
          {/* 计数不补零：个位数补零会被读成两个数字的拼接 bug */}
          <span className="data-readout text-[13px] text-[var(--text-faint)]">{rows.length}</span>
        </div>
        <div ref={listRef} className="max-h-[min(56vh,460px)] min-h-[200px] overflow-y-auto p-2">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">没有匹配的命令或项目</p>
          )}
          {rows.map((row, index) => {
            const selected = index === safeActive;
            if (row.kind === "command") {
              const Icon = row.command.icon;
              return (
                <button
                  key={row.command.id}
                  type="button"
                  data-active-row={selected ? "" : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => runRow(row)}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-sm)] border-l-2 px-3 py-2 text-left text-sm ${
                    selected ? "row-selected border-transparent" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon aria-hidden="true" size={16} strokeWidth={1.8} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{row.command.title}</span>
                  {row.command.hint && <kbd className="kbd shrink-0">{row.command.hint}</kbd>}
                </button>
              );
            }
            return (
              <button
                key={`item-${row.item.id}`}
                type="button"
                data-active-row={selected ? "" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => runRow(row)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-sm)] border-l-2 px-3 py-2 text-left text-sm ${
                  selected ? "row-selected border-transparent" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
                title={row.item.path}
              >
                <PackageOpen aria-hidden="true" size={17} strokeWidth={1.8} className="row-sub shrink-0 text-[var(--text-faint)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.item.name}</span>
                  {/* 第二行展示中段折叠的路径：同名对象靠位置区分（盘符 + 文件名信息量最高） */}
                  <span className="row-sub mt-0.5 block truncate text-[13px] leading-4 text-[var(--text-faint)]">
                    {truncatePathMiddle(row.item.path)}
                  </span>
                </span>
                <span className="row-sub shrink-0 text-[13px] text-[var(--text-faint)]">{getTypeLabel(row.item.type)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex min-h-9 items-center justify-between border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 text-[13px] text-[var(--text-faint)]">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-2"><span className="status-led" aria-hidden="true" />命令索引就绪</span>
            <span className="hidden sm:inline">↑↓ 选择 · Enter 执行 · Esc 关闭</span>
          </span>
          <span className="data-readout">{matchedCommands.length} 命令 · {matchedItems.length} 项目</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
