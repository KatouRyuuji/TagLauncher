import { describe, expect, it } from "vitest";
import { formatScanProgress, isScanCancelled, isScanTimedOut, scanErrorMessage, SCAN_CANCELLED_MSG } from "./relocateScan";

describe("relocateScan", () => {
  it("进度文案：万项、当前盘、用时/上限", () => {
    expect(formatScanProgress({ scanId: 1, scanned: 9_999, root: "D:\\", scoped: true, elapsedMs: 999, limitMs: 300_000 }))
      .toBe("已扫描 9999 项（D:\\）· 0:00 / 5:00");
    expect(formatScanProgress({ scanId: 1, scanned: 3_456_789, root: "C:\\", scoped: false, elapsedMs: 125_000, limitMs: 300_000 }))
      .toBe("已扫描 346 万项（C:\\）· 2:05 / 5:00");
  });

  it("区分停止与超时，并去掉命令名前缀", () => {
    const cancelled = new Error(`[relocate_missing] ${SCAN_CANCELLED_MSG}`);
    expect(isScanCancelled(cancelled)).toBe(true);
    expect(isScanTimedOut(cancelled)).toBe(false);
    expect(scanErrorMessage(cancelled)).toBe(SCAN_CANCELLED_MSG);
    const timedOut = new Error("[relocate_missing] 扫描超过时间上限（5 分钟，已扫描 1 项）：未完成唯一性核验");
    expect(isScanTimedOut(timedOut)).toBe(true);
    expect(isScanCancelled(timedOut)).toBe(false);
  });
});
