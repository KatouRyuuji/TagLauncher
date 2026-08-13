export function WorkspaceEmptyState({
  kind,
  onClearFilters,
}: {
  kind: "library" | "filter";
  onClearFilters?: () => void;
}) {
  const isFilter = kind === "filter";
  return (
    <div className="flex-1 overflow-auto">
      <div className="empty-state-panel">
        <div className="flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-xl)+4px)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            {isFilter ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A2.75 2.75 0 0 1 6.75 5h3.4a1.5 1.5 0 0 1 1.06.44l1.35 1.35c.28.28.66.44 1.06.44h3.63A2.75 2.75 0 0 1 20 10v6.25A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25V7.75Z" />
            )}
          </svg>
        </div>
        <div>
          <p className="text-lg font-semibold text-[var(--text-primary)]">
            {isFilter ? "没有匹配的项目" : "暂无项目"}
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {isFilter
              ? "试试清空筛选、换个类型，或按 / 重新搜索。"
              : "将文件或文件夹拖拽到主区域，或使用顶部按钮开始导入。"}
          </p>
          {isFilter && onClearFilters && (
            <button type="button" className="action-button mt-4" onClick={onClearFilters}>
              清空筛选
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
