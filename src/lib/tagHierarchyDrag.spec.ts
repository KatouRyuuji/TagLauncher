import { describe, expect, it } from "vitest";
import { describeParentChange, descendantIds, resolveHierarchyDrop } from "./tagHierarchyDrag";

// 钻石 + 链：A→C、B→C、C→D；E 独立
const rels = [
  { parentId: 1, childId: 3 },
  { parentId: 2, childId: 3 },
  { parentId: 3, childId: 4 },
];
const names: Record<number, string> = { 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" };

describe("tagHierarchyDrag", () => {
  it("后代闭包走完多父 DAG", () => {
    expect([...descendantIds(1, rels)].sort()).toEqual([3, 4]);
    expect([...descendantIds(4, rels)]).toEqual([]);
  });

  it("拖到标签上默认加边（多父），Alt 换边", () => {
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 5, move: false }, rels)).toEqual({
      ok: true, change: { childId: 3, fromParentId: null, toParentId: 5 },
    });
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 5, move: true }, rels)).toEqual({
      ok: true, change: { childId: 3, fromParentId: 1, toParentId: 5 },
    });
    // 顶层标签按 Alt 也只能加边（没有可换的父级）
    expect(resolveHierarchyDrop(5, null, { kind: "parent", parentId: 1, move: true }, rels)).toEqual({
      ok: true, change: { childId: 5, fromParentId: null, toParentId: 1 },
    });
  });

  it("防环、自身、已是下级", () => {
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 4, move: false }, rels)).toEqual({ ok: false, reason: "目标是它的下级标签，会形成循环" });
    expect(resolveHierarchyDrop(1, null, { kind: "parent", parentId: 4, move: false }, rels).ok).toBe(false);
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 3, move: false }, rels)).toEqual({ ok: false, reason: "不能拖到自身" });
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 2, move: false }, rels)).toEqual({ ok: false, reason: "已是它的下级标签" });
    // 从 A 下的 C 按 Alt 拖到 B（已是 B 的子）= 只删 A→C
    expect(resolveHierarchyDrop(3, 1, { kind: "parent", parentId: 2, move: true }, rels)).toEqual({
      ok: true, change: { childId: 3, fromParentId: 1, toParentId: 2 },
    });
  });

  it("移到顶层只删当前路径的父边", () => {
    expect(resolveHierarchyDrop(3, 2, { kind: "root" }, rels)).toEqual({ ok: true, change: { childId: 3, fromParentId: 2, toParentId: null } });
    expect(resolveHierarchyDrop(5, null, { kind: "root" }, rels)).toEqual({ ok: false, reason: "已在顶层" });
  });

  it("提示文案", () => {
    const n = (id: number) => names[id];
    expect(describeParentChange({ childId: 3, fromParentId: null, toParentId: 5 }, n)).toBe("已把「C」加到「E」下（保留原有父级）");
    expect(describeParentChange({ childId: 3, fromParentId: 1, toParentId: 5 }, n)).toBe("已把「C」从「A」移到「E」下");
    expect(describeParentChange({ childId: 3, fromParentId: 2, toParentId: null }, n)).toBe("已把「C」移出「B」");
  });
});
