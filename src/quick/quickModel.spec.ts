import { describe, expect, it } from "vitest";
import type { ItemWithTags } from "../types";
import { filterTagChoices, quickKeyAction, stepIndex, toggledTagIds } from "./quickModel";

const item = (id: number, name: string, extra: Partial<ItemWithTags> = {}): ItemWithTags => ({
  id, name, path: `D:/${name}`, type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [], ...extra,
});

describe("quickKeyAction", () => {
  const k = (key: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) =>
    quickKeyAction({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

  it("设计里的键位", () => {
    expect(k("Enter")).toBe("launch");
    expect(k("Enter", { ctrlKey: true })).toBe("reveal");
    expect(k("Enter", { altKey: true })).toBe("locate");
    expect(k("t", { ctrlKey: true })).toBe("tag");
    expect(k("C", { ctrlKey: true, shiftKey: true })).toBe("copy");
    expect(k("Escape")).toBe("escape");
    expect(k("ArrowDown")).toBe("down");
    expect(k("ArrowUp")).toBe("up");
  });

  it("普通编辑键不拦截（Ctrl+C 复制输入框文字、Ctrl+A 全选等）", () => {
    expect(k("a")).toBeNull();
    expect(k("c", { ctrlKey: true })).toBeNull();
    expect(k("a", { ctrlKey: true })).toBeNull();
    expect(k("t", { ctrlKey: true, shiftKey: true })).toBeNull();
  });
});

describe("辅助函数", () => {
  it("stepIndex 循环移动", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1);
    expect(stepIndex(3, 2, 1)).toBe(0);
    expect(stepIndex(3, 0, -1)).toBe(2);
    expect(stepIndex(3, -1, 1)).toBe(0);
  });

  it("toggledTagIds 切换并保持顺序", () => {
    const it2 = item(1, "x", { tags: [{ id: 5, name: "a", color: "#000" }, { id: 7, name: "b", color: "#000" }] });
    expect(toggledTagIds(it2, 7)).toEqual([5]);
    expect(toggledTagIds(it2, 9)).toEqual([5, 7, 9]);
  });

  it("filterTagChoices 过滤并把已有标签排前", () => {
    const tags = [{ id: 1, name: "工作" }, { id: 2, name: "工具" }, { id: 3, name: "游戏" }];
    expect(filterTagChoices(tags, "工", new Set([2])).map((t) => t.id)).toEqual([2, 1]);
    expect(filterTagChoices(tags, "", new Set()).map((t) => t.id)).toEqual([1, 2, 3]);
  });
});
