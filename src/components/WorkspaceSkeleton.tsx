// ============================================================================
// components/WorkspaceSkeleton.tsx — 首屏加载骨架屏
// ============================================================================
// 首次加载对象列表时按当前视图（网格/列表）渲染与真实布局同构的骨架占位，
// 避免"单点 spinner → 整屏内容"的跳变。仅用于首屏（后台刷新保留旧列表原地更新）。
// 微动效 shimmer 定义在 index.css（.skeleton-block），reduced-motion 下自动静止。
// ============================================================================

import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_GRID_TEMPLATE } from "./ItemRow";

/**
 * 骨架占位数量：按视口高度估算一屏行数（多算一行让底部被裁切，暗示"还有更多"），
 * 网格/大图标再乘估算列数。骨架是首屏瞬态，只算一次、不跟随 resize。
 */
function estimateCardCount(rowHeight: number, minColWidth: number): number {
  const rows = Math.max(2, Math.ceil(window.innerHeight / rowHeight) + 1);
  const cols = Math.max(2, Math.floor(window.innerWidth / minColWidth));
  return Math.min(48, rows * cols);
}

function estimateRowCount(): number {
  return Math.min(30, Math.ceil(window.innerHeight / ITEM_LIST_BASE_ROW_HEIGHT) + 1);
}

export function WorkspaceSkeleton({ view }: { view: "grid" | "list" | "icons" }) {
  return (
    <div
      className={view === "list" ? "flex-1 overflow-hidden" : "flex-1 overflow-hidden p-4"}
      role="status"
      aria-label="正在加载项目数据"
      data-region="workspace-skeleton"
    >
      {view === "list" ? <SkeletonList /> : view === "icons" ? <SkeletonIcons /> : <SkeletonGrid />}
    </div>
  );
}

function SkeletonIcons() {
  // 行高约 200px（方形封面 + 名称行），列宽对齐 --grid-col-min-icons 的默认档
  const count = estimateCardCount(200, 168);
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-col-min-icons), 1fr))" }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col items-center rounded-[var(--radius-xl)] border border-[var(--line-hairline)] bg-[var(--surface-raised)] p-2.5 shadow-[var(--shadow-card)]"
        >
          <div className="skeleton-block aspect-square w-full rounded-[var(--radius-lg)]" />
          <div className="skeleton-block mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  // 行高约 150px（图标 + 两行文本 + 标签行），列宽对齐 --grid-col-min 的默认档
  const count = estimateCardCount(150, 256);
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-col-min), 1fr))" }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col rounded-[var(--radius-xl)] border border-[var(--line-hairline)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-card)]"
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
  const count = estimateRowCount();
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
      {Array.from({ length: count }, (_, index) => (
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
