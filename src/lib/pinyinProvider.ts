// ============================================================================
// lib/pinyinProvider.ts — pinyin-pro 懒加载门面
// ----------------------------------------------------------------------------
// pinyin-pro 词典体积大（主包数百 KB），拆为独立分片：
// 搜索/高亮链路的两个异步入口（useSearch 防抖、命令面板防抖）与闲时预热
// 先 await ensurePinyin()，之后的同步调用经 pinyinSync 取模块。
// ============================================================================

type PinyinModule = typeof import("pinyin-pro");

let cached: PinyinModule | null = null;
let inflight: Promise<PinyinModule> | null = null;

/** 加载（或取已加载的）pinyin-pro；多次调用共享同一 Promise。失败不闩锁：重置 inflight，下次调用重试。 */
export function ensurePinyin(): Promise<PinyinModule> {
  if (cached) return Promise.resolve(cached);
  inflight ??= import("pinyin-pro").then((mod) => {
    cached = mod;
    return mod;
  });
  // 分片加载失败（WebView2 缓存损坏/杀软拦截）时必须可重试，
  // 否则 rejected Promise 被 ??= 永久闩锁，搜索整会话静默死亡
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

export function isPinyinReady(): boolean {
  return cached !== null;
}

/**
 * 同步取 pinyin：仅保证在 ensurePinyin() 完成之后调用
 * （搜索/高亮链路经防抖与预热门控；测试在 run() 前 await ensurePinyin()）。
 * 直接透传 pinyin-pro 的重载签名，各调用点（type: "array" 等）写法不变。
 */
export const pinyinSync: PinyinModule["pinyin"] = ((...args: unknown[]) => {
  if (!cached) throw new Error("pinyin-pro 尚未就绪：先 await ensurePinyin()");
  return (cached.pinyin as (...rest: unknown[]) => unknown)(...args);
}) as PinyinModule["pinyin"];
