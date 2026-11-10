// ============================================================================
// src/lib/relocateScan.ts — 失效找回扫描的进度 / 停止 / 时间上限（前端侧）
// ============================================================================
// 后端 relocate_missing 扫描时发 relocate-progress（约 250ms 一次），结束发 relocate-finished。
// 停止（cancel_relocate）与超过时间上限都不回写，命令以错误返回「未完成唯一性核验」说明。
// ============================================================================
import { useEffect, useState } from "react";

export const RELOCATE_PROGRESS_EVENT = "relocate-progress";
export const RELOCATE_FINISHED_EVENT = "relocate-finished";
/** 与后端 item_service::SCAN_CANCELLED_MSG 一致 */
export const SCAN_CANCELLED_MSG = "已停止扫描：未完成唯一性核验，没有回写任何对象。";
/** 与后端 item_service::SCAN_TIMED_OUT_PREFIX 一致 */
export const SCAN_TIMED_OUT_PREFIX = "扫描超过时间上限";

export interface RelocateProgress {
  scanId: number;
  scanned: number;
  root: string;
  scoped: boolean;
  elapsedMs: number;
  limitMs: number;
}

export interface RelocateFinished {
  scanId: number;
  status: "done" | "cancelled" | "timed_out" | "failed";
  recovered: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const isScanCancelled = (err: unknown) => errorText(err).includes(SCAN_CANCELLED_MSG);
export const isScanTimedOut = (err: unknown) => errorText(err).includes(SCAN_TIMED_OUT_PREFIX);

/** 去掉 invokeCmd 加的 [命令名] 前缀，给界面展示用 */
export function scanErrorMessage(err: unknown): string {
  return errorText(err).replace(/^\[[a-z_]+\]\s*/, "");
}

function formatCount(n: number): string {
  if (n < 10_000) return `${n} 项`;
  return `${(n / 10_000).toFixed(n < 1_000_000 ? 1 : 0)} 万项`;
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 「已扫描 12.3 万项（C:\）· 1:05 / 5:00」 */
export function formatScanProgress(p: RelocateProgress): string {
  return `已扫描 ${formatCount(p.scanned)}（${p.root}）· ${formatClock(p.elapsedMs)} / ${formatClock(p.limitMs)}`;
}

/** 当前在途扫描的最新进度（多个在途时取最近更新的一个）；结束后清空。 */
export function useRelocateScan(): RelocateProgress | null {
  const [active, setActive] = useState<Map<number, RelocateProgress>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const stops: Array<() => void> = [];
    void import("@tauri-apps/api/event")
      .then(({ listen }) => Promise.all([
        listen<RelocateProgress>(RELOCATE_PROGRESS_EVENT, (e) => {
          if (cancelled) return;
          setActive((cur) => {
            const next = new Map(cur);
            next.delete(e.payload.scanId);
            next.set(e.payload.scanId, e.payload);
            return next;
          });
        }),
        listen<RelocateFinished>(RELOCATE_FINISHED_EVENT, (e) => {
          if (cancelled) return;
          setActive((cur) => {
            if (!cur.has(e.payload.scanId)) return cur;
            const next = new Map(cur);
            next.delete(e.payload.scanId);
            return next;
          });
        }),
      ]))
      .then((handles) => {
        if (cancelled) handles.forEach((stop) => stop());
        else stops.push(...handles);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, []);
  const list = [...active.values()];
  return list.length > 0 ? list[list.length - 1] : null;
}
