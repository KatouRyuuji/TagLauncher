// ============================================================================
// components/WorkspaceSkeleton.tsx — 首屏加载骨架屏
// ============================================================================
// 首次加载对象列表时按当前视图（网格/列表）渲染与真实布局同构的骨架占位，
// 避免"单点 spinner → 整屏内容"的跳变。仅用于首屏（后台刷新保留旧列表原地更新）。
// 微动效 shimmer 定义在 index.css（.skeleton-block），reduced-motion 下自动静止。
// ============================================================================

import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_GRID_TEMPLATE } from "./ItemRow";

/** 骨架占位数量：略多于一屏的常见容量，底部被裁切以暗示"还有更多" */
const SKELETON_CARD_COUNT = 12;
const SKELETON_ROW_COUNT = 9;

export function WorkspaceSkeleton({ view }: { view: "grid" | "list" }) {
  return (
    <div
      className={view === "grid" ? "flex-1 overflow-hidden p-4" : "flex-1 overflow-hidden"}
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
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-col-min), 1fr))" }}
    >
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div
          key={index}
          className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--line-hairline)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-start gap-3">
            <div className="skeleton-block h-11 w-11 shrink-0 rounded-[var(--radius-md)]" />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <div className="skeleton-block h-3.5 w-3/4" />
              <div className="skeleton-block h-2.5 w-full" />
              <div className="skeleton-block h-2.5 w-1/3" />
            </div>
          </div>
          <div className="mt-2.5 flex min-h-7 items-center gap-1.5">
            <div className="skeleton-block h-6 w-14 rounded-[var(--radius-full)]" />
            <div className="skeleton-block h-6 w-16 rounded-[var(--radius-full)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div>
      <div
        className="grid h-9 items-center gap-3 border-b border-[var(--line-hairline)] px-4"
        style={{ gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
      >
        <span />
        <div className="skeleton-block h-2.5 w-16" />
        <div className="skeleton-block h-2.5 w-12" />
        <div className="skeleton-block ml-auto h-2.5 w-10" />
      </div>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <div
          key={index}
          className="grid items-center gap-3 border-b border-[var(--line-hairline)] px-4 py-2 last:border-b-0"
          style={{ minHeight: ITEM_LIST_BASE_ROW_HEIGHT, gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
        >
          <div className="flex gap-1">
            <div className="skeleton-block h-7 w-7 rounded-[var(--radius-md)]" />
            <div className="skeleton-block h-7 w-7 rounded-[var(--radius-md)]" />
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="skeleton-block h-9 w-9 shrink-0 rounded-[var(--radius-md)]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="skeleton-block h-3 w-1/2" />
              <div className="skeleton-block h-2.5 w-3/4" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <div className="skeleton-block h-5 w-14 rounded-[var(--radius-full)]" />
            <div className="skeleton-block h-5 w-16 rounded-[var(--radius-full)]" />
          </div>
          <div className="space-y-1.5">
            <div className="skeleton-block ml-auto h-3 w-12" />
            <div className="skeleton-block ml-auto h-2.5 w-8" />
          </div>
        </div>
      ))}
    </div>
  );
}
