import { assert, test, run } from "../../lib/__testutil";
import {
  formatClock,
  formatDurationMs,
  formatLocalDate,
  formatPixelSize,
  resolveMediaDurationSeconds,
} from "./previewFormat";

test("formatDurationMs：269000 → 4:29（晴天）", () => {
  assert.equal(formatDurationMs(269_000), "4:29");
});

test("formatClock：不可用时可用 --:-- 占位", () => {
  assert.equal(formatClock(null, "--:--"), "--:--");
  assert.equal(formatClock(Number.NaN, "--:--"), "--:--");
  assert.equal(formatClock(0), "0:00");
});

test("resolveMediaDurationSeconds：真实元素 duration 优先", () => {
  assert.equal(resolveMediaDurationSeconds(269, 269_000), 269);
});

test("resolveMediaDurationSeconds：极短占位回退 duration_ms", () => {
  assert.equal(resolveMediaDurationSeconds(0.3, 269_000), 269);
  assert.equal(resolveMediaDurationSeconds(0, 269_000), 269);
  assert.equal(resolveMediaDurationSeconds(Number.NaN, 269_000), 269);
});

test("resolveMediaDurationSeconds：无元数据时才用极短元素时长", () => {
  assert.equal(resolveMediaDurationSeconds(0.3, null), 0.3);
  assert.equal(resolveMediaDurationSeconds(null, null), null);
});

test("formatLocalDate：按本地日历出 YYYY-MM-DD", () => {
  const local = new Date(2025, 7, 24, 8, 26, 40);
  assert.equal(formatLocalDate(Math.floor(local.getTime() / 1000)), "2025-08-24");
});

test("formatPixelSize：宽高都大于 0 才格式化", () => {
  assert.equal(formatPixelSize(1920, 1080), "1920 × 1080");
  assert.equal(formatPixelSize(0, 1080), "");
});

await run("previewFormat");
