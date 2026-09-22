import { CircleAlert, FilePlus2, FilterX, FolderInput, FolderPlus, LibraryBig, RefreshCw, Search, SearchX, Tag } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { emptyStateCopy, resolveEmptyStateVariant } from "../lib/emptyStateCopy";
import { pickFilesToAdd, pickFoldersToAdd } from "../lib/importDialogs";
import { resetWorkspaceSearchInput } from "../lib/workspaceChrome";

/** 对象列表加载失败且本地无缓存时的错误面板：给出可读原因与重试入口。 */
export function WorkspaceLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-full items-center overflow-auto">
      <section className="empty-state-panel" role="alert" aria-labelledby="workspace-load-error-title">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-danger)_24%,var(--border-subtle))] bg-[var(--color-danger-bg)] text-[var(--color-danger-ink)] shadow-[var(--shadow-sm)]">
          <CircleAlert className="h-8 w-8" strokeWidth={1.6} aria-hidden="true" />
        </div>
        <div className="max-w-[480px]">
          <h2 id="workspace-load-error-title" className="text-base font-semibold text-[var(--text-primary)]">
            对象列表加载失败
          </h2>
          <p className="mt-2 break-words text-[13px] leading-5 text-[var(--text-muted)]">{message}</p>
          <button type="button" className="action-button mt-5" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            重试
          </button>
        </div>
      </section>
    </div>
  );
}

export function WorkspaceEmptyState({
  kind,
  onClearFilters,
  onAddItems,
}: {
  kind: "library" | "filter";
  onClearFilters?: () => void;
  onAddItems?: (paths: string[]) => Promise<void>;
}) {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const tags = useAppStore((state) => state.tags);
  const cabinets = useAppStore((state) => state.cabinets);
  const variant = resolveEmptyStateVariant(kind, searchQuery, {
    cabinet: selectedCabinetId !== null,
    favorites: showFavorites,
    recent: showRecent,
  });
  const copy = emptyStateCopy(variant, searchQuery, {
    hasTags: tags.length > 0,
    hasCabinets: cabinets.length > 0,
  });
  const EmptyIcon = variant === "library" ? LibraryBig : variant === "search" ? SearchX : FilterX;

  const handleClearSearch = () => {
    setSearchQuery("");
    // 同步清空搜索框内的文字（SearchBar 本地受控值），否则输入框残留旧词
    resetWorkspaceSearchInput();
  };

  // 与顶栏「添加」按钮同一入口：系统对话框选路径后交给 App 层 addItems
  const handleAddFiles = async () => {
    if (!onAddItems) return;
    const paths = await pickFilesToAdd();
    if (paths) await onAddItems(paths);
  };
  const handleAddFolders = async () => {
    if (!onAddItems) return;
    const paths = await pickFoldersToAdd();
    if (paths) await onAddItems(paths);
  };

  // 空库引导给出导入 CTA；筛选/搜索无结果态保持纯文字引导，不加导入按钮
  const showAddCta = variant === "library" && onAddItems;
  // 「清空所有筛选」只在确有筛选激活时出现（clearWorkspaceFilters 清的正是这些维度）：
  // 仅剩搜索词时由旁边的「清空搜索」承载，两个同效按钮并存只会让用户猜差异
  const hasActiveFilters =
    typeFilter !== "all" ||
    selectedTagIds.length > 0 ||
    excludedTagIds.length > 0 ||
    selectedCabinetId !== null ||
    showFavorites ||
    showRecent;
  const showClearFilters = copy.showClearFilters && Boolean(onClearFilters) && hasActiveFilters;
  const showActions = showAddCta || copy.showClearSearch || showClearFilters;

  return (
    <div className="flex min-h-full items-center overflow-auto">
      {/* 面板垂直居中（margin auto 吃掉上下剩余空间）；library 变体放大为近全区
          拖放引导面板，见 .empty-state-panel[data-empty-variant="library"] */}
      <section
        className="empty-state-panel"
        data-empty-variant={variant}
        role="status"
        aria-labelledby="workspace-empty-title"
      >
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--accent-primary)_22%,var(--border-subtle))] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] shadow-[var(--shadow-sm)]">
          <EmptyIcon className="h-8 w-8" strokeWidth={1.55} aria-hidden="true" />
        </div>
        <div className="max-w-[460px]">
          <h2 id="workspace-empty-title" className="break-words text-base font-semibold text-[var(--text-primary)]">
            {copy.title}
          </h2>
          <p className="mx-auto mt-2 max-w-[420px] font-body text-[13px] leading-5 text-[var(--text-muted)]">
            {copy.description}
          </p>
          {variant === "library" && (
            <ol className="empty-steps" aria-label="上手三步">
              <li>
                <FolderInput className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                <span>拖入文件或文件夹</span>
              </li>
              <li aria-hidden="true" className="empty-steps-arrow">→</li>
              <li>
                <Tag className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                <span>给项目打上标签</span>
              </li>
              <li aria-hidden="true" className="empty-steps-arrow">→</li>
              <li>
                <Search className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                <span><kbd className="kbd">Ctrl+K</kbd> 随时搜索</span>
              </li>
            </ol>
          )}
          {showActions && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {showAddCta && (
                <>
                  <button type="button" className="action-button" onClick={() => void handleAddFiles()}>
                    <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                    添加文件
                  </button>
                  <button type="button" className="action-button action-button-primary" onClick={() => void handleAddFolders()}>
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    添加文件夹
                  </button>
                </>
              )}
              {copy.showClearSearch && (
                <button type="button" className="action-button action-button-primary" onClick={handleClearSearch}>
                  <SearchX className="h-4 w-4" aria-hidden="true" />
                  清空搜索
                </button>
              )}
              {showClearFilters && (
                /* 与「清空搜索」同级：单独出现时升主按钮，两者并存时保持一次一主 */
                <button
                  type="button"
                  className={`action-button${copy.showClearSearch ? "" : " action-button-primary"}`}
                  onClick={onClearFilters}
                >
                  <FilterX className="h-4 w-4" aria-hidden="true" />
                  清空所有筛选
                </button>
              )}
            </div>
          )}
          {copy.footnote && (
            <p className="mx-auto mt-4 max-w-[420px] text-[12px] leading-5 text-[var(--text-faint)]">
              {copy.footnote}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
