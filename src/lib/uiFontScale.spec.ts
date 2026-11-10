import { describe, expect, it } from "vitest";
import { applyUiFontScale, isUiFontScale, scaledRowEstimate } from "./uiFontScale";

describe("界面字号", () => {
  it("只接受预设档位", () => {
    expect(isUiFontScale(1.1)).toBe(true);
    expect(isUiFontScale(3)).toBe(false);
    expect(isUiFontScale("1.1")).toBe(false);
  });

  it("标准档移除根变量，其它档写入", () => {
    const root = document.createElement("div");
    applyUiFontScale(1.25, root);
    expect(root.style.getPropertyValue("--ui-font-scale")).toBe("1.25");
    applyUiFontScale(1, root);
    expect(root.style.getPropertyValue("--ui-font-scale")).toBe("");
  });

  it("行高估计只随放大增加，缩小不压低最小行高", () => {
    expect(scaledRowEstimate(64, 1.25)).toBe(80);
    expect(scaledRowEstimate(56, 0.9)).toBe(56);
  });
});
