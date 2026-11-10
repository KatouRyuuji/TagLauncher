import { describe, expect, it } from "vitest";
import { autoRelocateFailureNotice, formatScanProgress, isScanCancelled, isScanTimedOut, scanErrorMessage, SCAN_CANCELLED_MSG, SCAN_TIMED_OUT_PREFIX } from "./relocateScan";

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

describe("autoRelocateFailureNotice（自动触发的全盘扫描同样受 5 分钟上限）", () => {
  it("停止 → info，超时 → warning 并保留引导文字，其余 → error", () => {
    const cancelled = autoRelocateFailureNotice(new Error(`[relocate_missing] ${SCAN_CANCELLED_MSG}`));
    expect(cancelled).toEqual({ message: SCAN_CANCELLED_MSG, tone: "info" });
    const timedOut = autoRelocateFailureNotice(
      new Error(`[relocate_missing] ${SCAN_TIMED_OUT_PREFIX}（5 分钟），未完成唯一性核验。请改用「在选定文件夹中找回…」`),
    );
    expect(timedOut.tone).toBe("warning");
    expect(timedOut.message).toContain("自动跨盘找回未完成");
    expect(timedOut.message).toContain("在选定文件夹中找回");
    expect(timedOut.message).not.toContain("[relocate_missing]");
    expect(autoRelocateFailureNotice(new Error("[relocate_missing] 磁盘不可读"))).toEqual({
      message: "跨盘找回失败：磁盘不可读",
      tone: "error",
    });
  });
});
