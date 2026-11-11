import { describe, expect, it } from "vitest";
import { flattenTagTree } from "./tagTree";
import { scopedTagSearch, scopeSearchKey, subtreeIds } from "./tagScopeSearch";

// 游戏(1) → 动作(2) → 动作射击(4)；影视(3) → 动作片(5)；共享子「收藏」(6) 同时在 游戏、影视 下
const tags = [
  { id: 1, name: "游戏" }, { id: 2, name: "动作" }, { id: 3, name: "影视" },
  { id: 4, name: "动作射击" }, { id: 5, name: "动作片" }, { id: 6, name: "收藏" }, { id: 7, name: "工具" },
];
const rels = [
  { parentId: 1, childId: 2 }, { parentId: 2, childId: 4 }, { parentId: 3, childId: 5 },
  { parentId: 1, childId: 6 }, { parentId: 3, childId: 6 },
];
const rows = flattenTagTree(tags, rels, (a, b) => a.id - b.id);
const has = (q: string) => (name: string) => name.includes(q);
const ids = (r: { rows: { tag: { id: number }; parentId: number | null }[] }) => r.rows.map((row) => `${row.parentId ?? "-"}>${row.tag.id}`);

describe("tagScopeSearch（F04c）", () => {
  it("子树闭包含全部下级", () => {
    expect([...subtreeIds([1], rels)].sort()).toEqual([1, 2, 4, 6]);
  });

  it("没有当前层或没有过滤词 = 原样 / 全局", () => {
    expect(scopedTagSearch(rows, rels, [1], "", has("x"), false).scope).toBe("all");
    const r = scopedTagSearch(rows, rels, [], "动作", has("动作"), false);
    expect(r.scope).toBe("all");
    expect(r.globalCount).toBe(3);
  });

  it("先只在当前层及下级里找；多父标签只取当前层那条路径", () => {
    const r = scopedTagSearch(rows, rels, [1], "动作", has("动作"), false);
    expect(r.scope).toBe("subtree");
    expect(ids(r)).toEqual(["1>2", "2>4"]);
    expect([r.subtreeCount, r.globalCount]).toEqual([2, 3]);
    const shared = scopedTagSearch(rows, rels, [1], "收藏", has("收藏"), false);
    expect(ids(shared)).toEqual(["1>6"]);
  });

  it("当前层没有命中时报告全局命中数；转全局后列出全部", () => {
    const miss = scopedTagSearch(rows, rels, [1], "工具", has("工具"), false);
    expect([miss.scope, miss.rows.length, miss.subtreeCount, miss.globalCount]).toEqual(["subtree", 0, 0, 1]);
    const global = scopedTagSearch(rows, rels, [1], "工具", has("工具"), true);
    expect(global.scope).toBe("global");
    expect(ids(global)).toEqual(["->7"]);
  });

  it("多个当前层取并集", () => {
    const r = scopedTagSearch(rows, rels, [1, 3], "动作", has("动作"), false);
    expect(ids(r)).toEqual(["1>2", "2>4", "3>5"]);
  });
});

describe("scopeSearchKey", () => {
  it("转全局只绑定当时的当前层与过滤词：整段换词或换层后不再相等", () => {
    const k = scopeSearchKey([1], "工具");
    expect(scopeSearchKey([1], " 工具 ")).toBe(k);
    expect(scopeSearchKey([1], "收藏")).not.toBe(k);
    expect(scopeSearchKey([2], "工具")).not.toBe(k);
    expect(scopeSearchKey([1, 2], "")).not.toBe(scopeSearchKey([12], ""));
  });
});

