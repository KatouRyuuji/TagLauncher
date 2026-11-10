// ============================================================================
// lib/mainPerf.ts — 主窗首屏与缓存规模采样（E2E 读取 window.__tlMainPerf）
// ============================================================================
// firstItemsMs：页面 timeOrigin → 首次有对象卡片提交后的下一帧。
// 只记一次，常驻开销可忽略；缓存规模由各缓存模块按需登记统计函数。
// ============================================================================

interface MainPerf {
  firstItemsMs?: number;
  firstItemsCount?: number;
  /** 最近一次页数据到达后列表提交的时刻（performance.now）：E2E 拆分跳转耗时用 */
  lastDataCommitMs?: number;
  stats: Record<string, () => unknown>;
}

function perf(): MainPerf {
  const w = window as unknown as { __tlMainPerf?: MainPerf };
  w.__tlMainPerf ??= { stats: {} };
  return w.__tlMainPerf;
}

/** 首屏：有对象的列表首次提交（effect 中调用），下一帧记录。 */
export function markFirstItems(count: number) {
  if (typeof window === "undefined" || count === 0) return;
  const p = perf();
  if (p.firstItemsMs !== undefined) return;
  p.firstItemsMs = -1;
  requestAnimationFrame(() => {
    p.firstItemsMs = performance.now();
    p.firstItemsCount = count;
  });
}

/** 列表因页数据到达而提交（layout effect 中调用）：只写一个时间戳 */
export function markDataCommit() {
  if (typeof window === "undefined") return;
  perf().lastDataCommitMs = performance.now();
}

/** 登记一个缓存统计函数（E2E 经 __tlMainPerf.stats[name]() 读取）。 */
export function registerPerfStats(name: string, fn: () => unknown) {
  if (typeof window === "undefined") return;
  perf().stats[name] = fn;
}
