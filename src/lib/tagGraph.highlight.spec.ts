import { describe, expect, it } from "vitest";
import { buildGraphHighlight } from "./tagGraph";

const rel = (parentId: number, childId: number) => ({ parentId, childId });
// 1 → 2 → 3 → 4，2 → 5；0 → 2（2 有两个父）；6 独立
const relations = [rel(1, 2), rel(2, 3), rel(3, 4), rel(2, 5), rel(0, 2)];

describe("buildGraphHighlight（F06 后代高亮）", () => {
  it("选中中间节点：直接父 + 全部后代，祖父不亮", () => {
    const h = buildGraphHighlight(2, relations);
    expect(Object.fromEntries(h.nodes)).toEqual({ 2: "selected", 1: "parent", 0: "parent", 3: "child", 5: "child", 4: "descendant" });
    expect(h.descendantCount).toBe(3);
    expect([...h.edges].sort()).toEqual(["0-2", "1-2", "2-3", "2-5", "3-4"]);
  });

  it("选中根：整棵子树高亮，含多父汇入的边", () => {
    const h = buildGraphHighlight(1, relations);
    expect(h.nodes.get(4)).toBe("descendant");
    expect(h.nodes.has(0)).toBe(false);
    expect(h.edges.has("0-2")).toBe(false);
    expect(h.descendantCount).toBe(4);
  });

  it("叶子或孤立节点：只有自身（与父）", () => {
    expect(buildGraphHighlight(4, relations).descendantCount).toBe(0);
    expect(Object.fromEntries(buildGraphHighlight(4, relations).nodes)).toEqual({ 4: "selected", 3: "parent" });
    expect(Object.fromEntries(buildGraphHighlight(6, relations).nodes)).toEqual({ 6: "selected" });
  });
});
