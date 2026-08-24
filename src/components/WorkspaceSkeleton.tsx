// ============================================================================
// components/WorkspaceSkeleton.tsx — 首屏加载骨架屏
// ============================================================================
// 首次加载对象列表时按当前视图（网格/列表）渲染与真实布局同构的骨架占位，
// 避免"单点 spinner → 整屏内容"的跳变。仅用于首屏（后台刷新保留旧列表原地更新）。
// 微动效 shimmer 定义在 index.css（.skeleton-block），reduced-motion 下自动静止。
// ============================================================================

/** 骨架占位数量：略多于一屏的常见容量，底部被裁切以暗示"还有更多" */
const SKELETON_CARD_COUNT = 12;
const SKELETON_ROW_COUNT = 9;

export function WorkspaceSkeleton({ view }: { view: "grid" | "list" }) {
  return (
    <div
      className="flex-1 overflow-hidden px-5 py-5"
      role="status"
      aria-label="正在加载项目数据"
      data-region="workspace-skeleton"
    >
      {view === "grid" ? <SkeletonGrid /> : <SkeletonList />}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-col-min), 1fr))" }}
    >
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div
          key={index}
          className="flex min-h-[156px] flex-col rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"
        >
          <div className="flex items-center gap-2.5">
            <div className="skeleton-block h-11 w-11 shrink-0 rounded-[var(--radius-md)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton-block h-2.5 w-12" />
              <div className="skeleton-block h-3.5 w-3/4" />
            </div>
          </div>
          <div className="skeleton-block mt-3 h-2.5 w-full" />
          <div className="skeleton-block mt-1.5 h-2.5 w-2/3" />
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
            <div className="skeleton-block h-3 w-10" />
            <div className="skeleton-block h-6 w-14 rounded-[var(--radius-full)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="surface-card overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="skeleton-block h-3 w-40" />
      </div>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[56px_minmax(0,1fr)_minmax(180px,300px)_112px] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
        >
          <div className="skeleton-block h-11 w-11 rounded-[var(--radius-md)]" />
          <div className="space-y-2">
            <div className="skeleton-block h-3.5 w-1/2" />
            <div className="skeleton-block h-2.5 w-3/4" />
          </div>
          <div className="flex gap-1.5">
            <div className="skeleton-block h-5 w-14 rounded-[var(--radius-full)]" />
            <div className="skeleton-block h-5 w-16 rounded-[var(--radius-full)]" />
          </div>
          <div className="skeleton-block ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
