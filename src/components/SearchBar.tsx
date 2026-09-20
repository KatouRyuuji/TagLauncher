import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  FilePlus2,
  Filter,
  FolderPlus,
  Grid2X2,
  Images,
  Info,
  List,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useSearch } from "../hooks/useSearch";
import { notifySearchInput } from "../lib/modApi";
import { useAppStore, type SearchMode } from "../stores/appStore";
import { pickFilesToAdd, pickFoldersToAdd } from "../lib/importDialogs";
import { SORT_OPTIONS, TYPE_FILTERS, nextTypeFilter, type SortMode } from "../lib/itemQuery";
import { classifySearchQuery } from "../lib/search";
import { SEARCH_RESET_EVENT, WORKSPACE_SEARCH_ID } from "../lib/workspaceChrome";
import { SelectMenu } from "./SelectMenu";
import {
  getToolbarButtons,
  subscribeToolbarButtons,
  type ToolbarButtonDescriptor,
} from "../lib/modToolbarRegistry";

interface SearchBarProps {
  onAddItems: (paths: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenAbout: () => void;
  onOpenSettings?: () => void;
  hasLibraryItems?: boolean;
}

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: "all", label: "全部", hint: "搜索范围：名称、路径与标签" },
  { value: "name", label: "名称", hint: "搜索范围：仅名称与路径" },
  { value: "tag", label: "标签", hint: "搜索范围：仅标签" },
];

const PLACEHOLDERS: Record<SearchMode, string> = {
  all: "搜索名称、路径或标签...",
  name: "搜索名称或路径...",
  tag: "搜索标签...",
};

export function SearchBar({ onAddItems, onRefresh, onOpenAbout, onOpenSettings, hasLibraryItems = true }: SearchBarProps) {
  const { handleSearch } = useSearch();
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const searchMode = useAppStore((state) => state.searchMode);
  const setSearchMode = useAppStore((state) => state.setSearchMode);
  const sortMode = useAppStore((state) => state.sortMode);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const workspaceFiltersOpen = useAppStore((state) => state.workspaceFiltersOpen);
  const setWorkspaceFiltersOpen = useAppStore((state) => state.setWorkspaceFiltersOpen);
  const [inputValue, setInputValue] = useState("");
  const queryKind = classifySearchQuery(inputValue);
  const filtersForcedOpen = typeFilter !== "all" || searchMode !== "all";
  const showFilterRow = hasLibraryItems && (workspaceFiltersOpen || filtersForcedOpen);
  const [modButtons, setModButtons] = useState<ToolbarButtonDescriptor[]>([]);
  const composingRef = useRef(false);

  useEffect(() => {
    const update = () => setModButtons(getToolbarButtons());
    update();
    return subscribeToolbarButtons(update);
  }, []);

  useEffect(() => {
    const reset = () => {
      setInputValue("");
      handleSearch("");
      notifySearchInput("");
    };
    window.addEventListener(SEARCH_RESET_EVENT, reset);
    return () => window.removeEventListener(SEARCH_RESET_EVENT, reset);
  }, [handleSearch]);

  const handleBrowse = async () => {
    const paths = await pickFilesToAdd();
    if (paths) await onAddItems(paths);
  };

  const handleBrowseFolder = async () => {
    const paths = await pickFoldersToAdd();
    if (paths) await onAddItems(paths);
  };

  const clearSearch = () => {
    setInputValue("");
    handleSearch("");
    notifySearchInput("");
  };

  return (
    <header data-region="searchbar" className="shrink-0">
      <div className="toolbar-strip flex h-12 items-center gap-2 px-3">
        <div
          role="search"
          className="input-frame flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5"
        >
          <label htmlFor={WORKSPACE_SEARCH_ID} className="sr-only">
            搜索项目
          </label>
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          <input
            id={WORKSPACE_SEARCH_ID}
            type="search"
            aria-label="搜索项目"
            placeholder={PLACEHOLDERS[searchMode]}
            value={inputValue}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setInputValue(value);
              handleSearch(value);
              notifySearchInput(value);
            }}
            onChange={(event) => {
              const value = event.target.value;
              setInputValue(value);
              if (composingRef.current) return;
              handleSearch(value);
              notifySearchInput(value);
            }}
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-placeholder)] outline-none [&::-webkit-search-cancel-button]:hidden"
          />

          {searchMode !== "all" && !showFilterRow && (
            <button
              type="button"
              data-testid="search-mode-badge"
              onClick={() => setSearchMode("all")}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent-primary)_36%,transparent)] bg-[var(--accent-primary-bg)] px-1.5 text-[13px] font-semibold text-[var(--accent-primary)] hover:border-[var(--accent-primary)]"
              title={`退出「仅${MODES.find((mode) => mode.value === searchMode)?.label}」模式，恢复搜索全部范围（保留当前关键词）`}
              aria-label="退出搜索模式，恢复搜索全部范围"
            >
              仅{MODES.find((mode) => mode.value === searchMode)?.label}
              <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
          )}

          {queryKind === "pinyin" && (
            <span
              data-testid="search-kind-pinyin"
              className="inline-flex h-6 shrink-0 items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-1.5 text-[12px] font-medium text-[var(--text-secondary)]"
              title="按拼音或英文缩写匹配名称与标签"
            >
              拼音
            </span>
          )}
          {queryKind === "expression" && (
            <span
              data-testid="search-kind-expression"
              className="inline-flex h-6 shrink-0 items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-1.5 text-[12px] font-medium text-[var(--text-secondary)]"
              title="表达式：&& 同时满足，|| 任一满足，!! 排除"
            >
              表达式
            </span>
          )}

          {inputValue && (
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              title="清空搜索"
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}

          {/* 输入态让位给模式徽章与清空 ×，空框时才显示命令面板入口 */}
          {!inputValue && (
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="kbd inline-flex h-6 shrink-0 items-center hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]"
              title="命令面板（Ctrl+K）"
              aria-label="打开命令面板（Ctrl+K）"
            >
              Ctrl+K
            </button>
          )}
        </div>

        <div role="group" aria-label="显示方式" className="segmented-control h-8 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`control-chip h-6 min-h-6 w-7 gap-1 rounded-[var(--radius-sm)] border-0 px-0 xl:w-auto xl:px-1.5 ${
              viewMode === "grid" ? "control-chip-active" : ""
            }`}
            title="网格视图"
            aria-label="网格视图"
            aria-pressed={viewMode === "grid"}
          >
            <Grid2X2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden xl:inline">网格</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("icons")}
            className={`control-chip h-6 min-h-6 w-7 gap-1 rounded-[var(--radius-sm)] border-0 px-0 xl:w-auto xl:px-1.5 ${
              viewMode === "icons" ? "control-chip-active" : ""
            }`}
            title="大图标视图"
            aria-label="大图标视图"
            aria-pressed={viewMode === "icons"}
          >
            <Images className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden xl:inline">大图标</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`control-chip h-6 min-h-6 w-7 gap-1 rounded-[var(--radius-sm)] border-0 px-0 xl:w-auto xl:px-1.5 ${
              viewMode === "list" ? "control-chip-active" : ""
            }`}
            title="列表视图"
            aria-label="列表视图"
            aria-pressed={viewMode === "list"}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden xl:inline">列表</span>
          </button>
        </div>

        <div role="group" aria-label="导入" className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleBrowse}
            className="action-button h-8 min-h-8 px-2.5 text-xs max-[1150px]:w-8 max-[1150px]:px-0"
            title="添加文件"
            aria-label="添加文件"
          >
            <FilePlus2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-[1150px]:hidden">添加文件</span>
          </button>
          <button
            type="button"
            onClick={handleBrowseFolder}
            className="action-button h-8 min-h-8 px-2.5 text-xs max-[1150px]:w-8 max-[1150px]:px-0"
            title="添加文件夹"
            aria-label="添加文件夹"
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-[1150px]:hidden">添加文件夹</span>
          </button>
        </div>

        {modButtons.length > 0 && (
          <div className="flex min-w-0 max-w-64 shrink items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {modButtons.map((button) => (
              <button
                key={`${button.modId}::${button.id}`}
                type="button"
                data-mod-toolbar={button.modId}
                onClick={button.onClick}
                className="action-button h-8 min-h-8 shrink-0 px-2.5 text-xs"
                title={button.text}
              >
                {button.icon ? (
                  <span
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: button.icon }}
                  />
                ) : null}
                {button.text}
              </button>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1 border-l border-[var(--line-hairline)] pl-2">
          {hasLibraryItems && (
            <button
              type="button"
              onClick={() => setWorkspaceFiltersOpen(!showFilterRow)}
              className={`icon-button relative h-8 w-8 ${showFilterRow ? "text-[var(--accent-primary)]" : ""}`}
              title="筛选"
              aria-label="筛选"
              aria-pressed={showFilterRow}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {/* 激活筛选计数外显：行收起时也能看出有筛选在作用 */}
              {(typeFilter !== "all" || searchMode !== "all") && (
                <span
                  className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-0.5 text-[10px] font-semibold leading-none text-[var(--text-invert)]"
                  aria-label={`${(typeFilter !== "all" ? 1 : 0) + (searchMode !== "all" ? 1 : 0)} 个筛选激活`}
                >
                  {(typeFilter !== "all" ? 1 : 0) + (searchMode !== "all" ? 1 : 0)}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="icon-button h-8 w-8"
            title="刷新"
            aria-label="刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="icon-button h-8 w-8"
              title="设置"
              aria-label="设置"
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAbout}
            className="icon-button h-8 w-8"
            title="关于 TagLauncher"
            aria-label="关于 TagLauncher"
          >
            <Info className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 控制 + 筛选：有库时默认展开（尊重 workspaceFiltersOpen 偏好）；空库不显示 */}
      {showFilterRow && <div
        data-region="filterbar"
        className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--line-hairline)] bg-[var(--bg-surface)] px-3 py-1.5"
      >
        {/* 组标签区分「搜」与「筛」：两组 pill 样式相同，职责不同，没标签难以分辨 */}
        <span className="instrument-label shrink-0 text-[var(--text-faint)]">范围</span>
        <div role="group" aria-label="搜索范围" className="segmented-control h-8 shrink-0">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSearchMode(mode.value)}
              className={`control-chip h-6 min-h-6 rounded-[var(--radius-sm)] border-0 px-2.5 text-[13px] font-medium ${
                searchMode === mode.value ? "control-chip-active" : ""
              }`}
              aria-pressed={searchMode === mode.value}
              title={mode.hint}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <span className="h-5 w-px shrink-0 bg-[var(--line-hairline)]" aria-hidden="true" />

        <div
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-secondary)]"
          title={SORT_OPTIONS.find((option) => option.value === sortMode)?.hint}
        >
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          <span className="instrument-label max-[1250px]:hidden">排序</span>
          <SelectMenu
            value={sortMode}
            onChange={(next) => setSortMode(next as SortMode)}
            options={SORT_OPTIONS}
            ariaLabel="排序方式"
            className="flex h-full min-w-14 items-center gap-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none"
          />
        </div>

        <span className="h-5 w-px shrink-0 bg-[var(--line-hairline)]" aria-hidden="true" />

        <div className="flex min-w-0 flex-1 basis-[360px] flex-wrap items-center gap-2">
          <span className="instrument-label shrink-0 text-[var(--text-faint)]">类型</span>
          <div role="group" aria-label="文件类型筛选" className="segmented-control min-h-8 max-w-full flex-wrap">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTypeFilter(nextTypeFilter(typeFilter, filter.value))}
                aria-pressed={typeFilter === filter.value}
                className={`control-chip h-6 min-h-6 shrink-0 rounded-[var(--radius-sm)] border-0 px-2.5 text-[13px] font-medium ${
                  typeFilter === filter.value ? "control-chip-active" : ""
                }`}
                title={typeFilter === filter.value && filter.value !== "all" ? "再次点击取消筛选" : filter.label}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>}
    </header>
  );
}
