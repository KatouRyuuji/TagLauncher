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
      <div className="empty-state-panel">
        <div className="flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-xl)+4px)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <div>
          <p className="text-lg font-semibold text-[var(--text-primary)]">对象列表加载失败</p>
          <p className="mx-auto mt-2 max-w-[420px] break-all text-sm text-[var(--text-muted)]">{message}</p>
          <button type="button" className="action-button mt-4" onClick={onRetry}>
            重试
          </button>
        </div>
      </div>
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

  const handleClearSearch = () => {
    setSearchQuery("");
    // 同步清空搜索框内的文字（SearchBar 本地受控值），否则输入框残留旧词
    resetWorkspaceSearchInput();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="empty-state-panel" data-empty-variant={variant}>
        <div className="flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-xl)+4px)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            {variant === "library" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A2.75 2.75 0 0 1 6.75 5h3.4a1.5 1.5 0 0 1 1.06.44l1.35 1.35c.28.28.66.44 1.06.44h3.63A2.75 2.75 0 0 1 20 10v6.25A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25V7.75Z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
            )}
          </svg>
        </div>
        <div>
          <p className="break-all text-lg font-semibold text-[var(--text-primary)]">{copy.title}</p>
          <p className="mx-auto mt-2 max-w-[380px] text-sm text-[var(--text-muted)]">{copy.description}</p>
          {(copy.showClearSearch || (copy.showClearFilters && onClearFilters)) && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {copy.showClearSearch && (
                <button type="button" className="action-button action-button-primary" onClick={handleClearSearch}>
                  清空搜索
                </button>
              )}
              {copy.showClearFilters && onClearFilters && (
                <button type="button" className="action-button" onClick={onClearFilters}>
                  清空所有筛选
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
