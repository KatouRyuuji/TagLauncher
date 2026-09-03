import { CircleAlert, FilterX, LibraryBig, RefreshCw, SearchX } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { emptyStateCopy, resolveEmptyStateVariant } from "../lib/emptyStateCopy";
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
    <div className="flex-1 overflow-auto">
      <section className="empty-state-panel" role="alert" aria-labelledby="workspace-load-error-title">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-danger)_24%,var(--border-subtle))] bg-[var(--color-danger-bg)] text-[var(--color-danger)] shadow-[var(--shadow-sm)]">
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
}: {
  kind: "library" | "filter";
  onClearFilters?: () => void;
}) {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const variant = resolveEmptyStateVariant(kind, searchQuery);
  const copy = emptyStateCopy(variant, searchQuery);
  const EmptyIcon = variant === "library" ? LibraryBig : variant === "search" ? SearchX : FilterX;

  const handleClearSearch = () => {
    setSearchQuery("");
    // 同步清空搜索框内的文字（SearchBar 本地受控值），否则输入框残留旧词
    resetWorkspaceSearchInput();
  };

  return (
    <div className="flex-1 overflow-auto">
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
          {(copy.showClearSearch || (copy.showClearFilters && onClearFilters)) && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {copy.showClearSearch && (
                <button type="button" className="action-button action-button-primary" onClick={handleClearSearch}>
                  <SearchX className="h-4 w-4" aria-hidden="true" />
                  清空搜索
                </button>
              )}
              {copy.showClearFilters && onClearFilters && (
                <button type="button" className="action-button" onClick={onClearFilters}>
                  <FilterX className="h-4 w-4" aria-hidden="true" />
                  清空所有筛选
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
