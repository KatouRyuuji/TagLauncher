// ============================================================================
// lib/searchPerf.ts — 主窗搜索耗时采样（E2E 读取 window.__tlMainSearchPerf）
// ============================================================================
// input：搜索框输入该词的时刻；apply：防抖结束、搜索词生效的时刻；
// result：该词的结果提交后的下一帧。只保留最近 200 条，常驻开销可忽略。
// ============================================================================

export interface MainSearchPerfRecord {
  q: string;
  results: number;
  /** 输入 → 结果提交后的下一帧（含 150ms 防抖） */
  inputMs: number | null;
  /** 搜索词生效 → 结果提交后的下一帧（搜索本身的耗时） */
  applyMs: number | null;
}

interface MainSearchPerf {
  records: MainSearchPerfRecord[];
  inputAt: Record<string, number>;
  applyAt: Record<string, number>;
}

const MAX = 200;

function perf(): MainSearchPerf {
  const w = window as unknown as { __tlMainSearchPerf?: MainSearchPerf };
  w.__tlMainSearchPerf ??= { records: [], inputAt: {}, applyAt: {} };
  return w.__tlMainSearchPerf;
}

export function markSearchInput(q: string) {
  if (typeof window === "undefined") return;
  perf().inputAt[q] = performance.now();
}

export function markSearchApplied(q: string) {
  if (typeof window === "undefined") return;
  perf().applyAt[q] = performance.now();
}

/** 结果已提交（effect 中调用）：下一帧记一条，并清掉该词的起点避免重复计数。 */
export function markSearchResult(q: string, results: number) {
  if (typeof window === "undefined" || !q.trim()) return;
  const p = perf();
  const inputAt = p.inputAt[q];
  const applyAt = p.applyAt[q];
  if (inputAt === undefined && applyAt === undefined) return;
  delete p.inputAt[q];
  delete p.applyAt[q];
  requestAnimationFrame(() => {
    const now = performance.now();
    p.records.push({
      q,
      results,
      inputMs: inputAt === undefined ? null : now - inputAt,
      applyMs: applyAt === undefined ? null : now - applyAt,
    });
    if (p.records.length > MAX) p.records.splice(0, p.records.length - MAX);
  });
}
