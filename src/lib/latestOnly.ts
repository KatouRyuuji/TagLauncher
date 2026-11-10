// ============================================================================
// lib/latestOnly.ts — 只跑最新一次的请求调度（搜索输入用）
// ----------------------------------------------------------------------------
// 后端搜索在同一把索引锁上串行：逐键都发请求时，慢机器上会排出一串注定被丢弃的旧查询，
// 最后一个词要等它们全部跑完。这里同一时刻只有一个请求在途；在途期间的新调用只保留最后一次，
// 被顶掉的调用以 SKIPPED 结束（调用方本就会丢弃过期结果），在途请求结束后立即发出保留的那次。
// ============================================================================

export const SKIPPED: unique symbol = Symbol("latestOnly.skipped");
export type Skipped = typeof SKIPPED;

export function latestOnly<A, R>(fn: (args: A) => Promise<R>): (args: A) => Promise<R | Skipped> {
  let running = false;
  let queued: { args: A; resolve: (v: R | Skipped) => void; reject: (e: unknown) => void } | null = null;

  const start = (args: A, resolve: (v: R | Skipped) => void, reject: (e: unknown) => void) => {
    running = true;
    let p: Promise<R>;
    try {
      p = fn(args);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(resolve, reject).finally(() => {
      running = false;
      const next = queued;
      queued = null;
      if (next) start(next.args, next.resolve, next.reject);
    });
  };

  return (args: A) =>
    new Promise<R | Skipped>((resolve, reject) => {
      if (!running) {
        start(args, resolve, reject);
        return;
      }
      queued?.resolve(SKIPPED);
      queued = { args, resolve, reject };
    });
}
