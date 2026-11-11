// ============================================================================
// quick/quickPerf.ts — 快速窗性能采样（E2E 读取 window.__tlQuickPerf）
// ============================================================================
// summon：唤出请求（热键回调时刻，后端传来的 Unix 毫秒）→ 输入框已聚焦后的下一帧。
// query：输入事件时刻 → 结果提交后的下一帧（同一 performance 时钟）。
// load：取对象 + 拼音就绪的耗时（隐藏期间进行，不在唤出路径上）。
// memory：后端切换 WebView2 内存目标（隐藏久了 low、唤出 normal）后发来的事件。
// 只保留最近 200 条，常驻开销可忽略。
// ============================================================================

export interface QuickPerf {
  summons: Array<{ t0Ms: number; readyAtMs: number; ms: number; focused: boolean }>;
  queries: Array<{ q: string; results: number; ms: number; items: number }>;
  loads: Array<{ items: number; ms: number }>;
  memory: Array<{ level: string; atMs: number }>;
}

const MAX = 200;

function perf(): QuickPerf {
  const w = window as unknown as { __tlQuickPerf?: QuickPerf };
  w.__tlQuickPerf ??= { summons: [], queries: [], loads: [], memory: [] };
  return w.__tlQuickPerf;
}

function push<T>(list: T[], entry: T) {
  list.push(entry);
  if (list.length > MAX) list.splice(0, list.length - MAX);
}

export function recordQuickSummon(t0Ms: number, readyAtMs: number, focused: boolean) {
  push(perf().summons, { t0Ms, readyAtMs, ms: readyAtMs - t0Ms, focused });
}

export function recordQuickQuery(q: string, results: number, ms: number, items: number) {
  push(perf().queries, { q, results, ms, items });
}

export function recordQuickLoad(items: number, ms: number) {
  push(perf().loads, { items, ms });
}

export function recordQuickMemory(level: string, atMs: number) {
  push(perf().memory, { level, atMs });
}
