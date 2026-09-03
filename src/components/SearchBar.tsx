import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  Command,
  FilePlus2,
  FolderPlus,
  Grid2X2,
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

export function SearchBar({ onAddItems, onRefresh, onOpenAbout, onOpenSettings }: SearchBarProps) {
  const { handleSearch } = useSearch();
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const searchMode = useAppStore((state) => state.searchMode);
  const setSearchMode = useAppStore((state) => state.setSearchMode);
  const sortMode = useAppStore((state) => state.sortMode);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const [inputValue, setInputValue] = useState("");
  const [modButtons, setModButtons] = useState<ToolbarButtonDescriptor[]>([]);
  const composingRef = useRef(false);
  const filterScrollRef = useRef<HTMLDivElement>(null);

  // 筛选区是水平滚动容器：把纵向滚轮转为横向滚动，标签多时不用拖动滚动条。
  // React 的 onWheel 在根节点以 passive 注册、无法 preventDefault，须手动挂非 passive 监听。
  useEffect(() => {
    const el = filterScrollRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.deltaX !== 0 || event.shiftKey) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // 右缘渐隐提示"后面还有内容"：仅在可滚且未滚到底时加 filter-scroll-more 类
  useEffect(() => {
    const el = filterScrollRef.current;
    if (!el) return;
    const update = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      el.classList.toggle("filter-scroll-more", canScroll && !atEnd);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

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
          className="workbench-panel flex h-8 min-w-[220px] flex-1 items-center gap-2 overflow-hidden px-2.5 shadow-none focus-within:border-[var(--accent-primary)] focus-within:ring-1 focus-within:ring-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]"
        >
          <label htmlFor={WORKSPACE_SEARCH_ID} className="sr-only">
            搜索启动项
          </label>
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          <input
            id={WORKSPACE_SEARCH_ID}
            type="search"
            aria-label="搜索启动项"
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

          {searchMode !== "all" && (
            <button
              type="button"
              data-testid="search-mode-badge"
              onClick={() => setSearchMode("all")}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent-primary)_36%,transparent)] bg-[var(--accent-primary-bg)] px-1.5 text-[10px] font-semibold text-[var(--accent-primary)] hover:border-[var(--accent-primary)]"
              title={`当前只搜${MODES.find((mode) => mode.value === searchMode)?.label}；点击恢复为“全部”`}
            >
              仅{MODES.find((mode) => mode.value === searchMode)?.label}
              <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
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

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="命令面板"
            aria-label="打开命令面板"
          >
            <Command className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
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

      {/* 控制 + 筛选合并行（单行 chrome）：搜索范围、排序、视图切换、类型/标签筛选、导入 */}
      <div
        data-region="filterbar"
        className="flex h-11 items-center gap-2 border-b border-[var(--line-hairline)] bg-[var(--bg-surface)] px-3"
      >
        <div role="group" aria-label="搜索范围" className="segmented-control h-8 shrink-0">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSearchMode(mode.value)}
              className={`control-chip h-6 min-h-6 rounded-[var(--radius-sm)] border-0 px-2.5 text-[12px] font-medium ${
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

        <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-secondary)]">
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          <span className="instrument-label max-[1250px]:hidden">排序</span>
          <SelectMenu
            value={sortMode}
            onChange={(next) => setSortMode(next as SortMode)}
            options={SORT_OPTIONS}
            ariaLabel="排序方式"
            className="flex h-full min-w-14 items-center gap-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
          />
        </div>

        <div role="group" aria-label="显示方式" className="segmented-control h-8 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`control-chip h-6 min-h-6 w-7 rounded-[var(--radius-sm)] border-0 px-0 ${
              viewMode === "grid" ? "control-chip-active" : ""
            }`}
            title="网格视图"
            aria-label="网格视图"
            aria-pressed={viewMode === "grid"}
          >
            <Grid2X2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`control-chip h-6 min-h-6 w-7 rounded-[var(--radius-sm)] border-0 px-0 ${
              viewMode === "list" ? "control-chip-active" : ""
            }`}
            title="列表视图"
            aria-label="列表视图"
            aria-pressed={viewMode === "list"}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <span className="h-5 w-px shrink-0 bg-[var(--line-hairline)]" aria-hidden="true" />

        {/* 类型 + 标签筛选：占据行内弹性空间，超出横向滚动（右缘渐隐提示可滚动） */}
        <div
          ref={filterScrollRef}
          className="filter-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-1 [&::-webkit-scrollbar]:hidden"
        >
          <div role="group" aria-label="文件类型筛选" className="segmented-control h-8 shrink-0">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTypeFilter(nextTypeFilter(typeFilter, filter.value))}
                aria-pressed={typeFilter === filter.value}
                className={`control-chip h-6 min-h-6 shrink-0 rounded-[var(--radius-sm)] border-0 px-2.5 text-[12px] font-medium ${
                  typeFilter === filter.value ? "control-chip-active" : ""
                }`}
                title={typeFilter === filter.value && filter.value !== "all" ? "再次点击取消筛选" : filter.label}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <span className="h-5 w-px shrink-0 bg-[var(--line-hairline)]" aria-hidden="true" />
          )}

          {tags.length > 0 && (
            <div role="group" aria-label="标签筛选" className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedTagIds([])}
                aria-pressed={selectedTagIds.length === 0}
                className={`control-chip h-7 min-h-7 shrink-0 px-2.5 text-[12px] font-medium ${
                  selectedTagIds.length === 0 ? "control-chip-active" : ""
                }`}
              >
                全部标签
              </button>

              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTagSelection(tag.id)}
                    className="inline-flex h-7 min-h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[12px] font-medium text-[var(--text-secondary)]"
                    aria-pressed={active}
                    title={tag.name}
                    style={{
                      borderColor: active
                        ? `color-mix(in srgb, ${tag.color} 48%, var(--border-default))`
                        : `color-mix(in srgb, ${tag.color} 24%, var(--border-subtle))`,
                      backgroundColor: active
                        ? `color-mix(in srgb, ${tag.color} 17%, var(--bg-card))`
                        : `color-mix(in srgb, ${tag.color} 7%, transparent)`,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      boxShadow: active ? `inset 0 -2px 0 ${tag.color}` : "none",
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-[1px]"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    <span>{tag.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div role="group" aria-label="导入" className="flex shrink-0 items-center gap-1.5 border-l border-[var(--line-hairline)] pl-2">
          <button
            type="button"
            onClick={handleBrowse}
            className="action-button h-8 min-h-8 px-2.5 text-xs max-[1150px]:w-8 max-[1150px]:px-0"
            title="添加文件"
          >
            <FilePlus2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-[1150px]:hidden">添加文件</span>
          </button>

          <button
            type="button"
            onClick={handleBrowseFolder}
            className="action-button action-button-primary h-8 min-h-8 px-2.5 text-xs max-[1150px]:w-8 max-[1150px]:px-0"
            title="添加文件夹"
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-[1150px]:hidden">添加文件夹</span>
          </button>
        </div>
      </div>
    </header>
  );
}
