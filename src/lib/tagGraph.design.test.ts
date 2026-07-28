import { assert, test, run } from "./__testutil";
import { buildChildrenMap, buildParentsMap, buildDescendantsMap, computeLayers, orderLayersByBarycenter } from "./tagGraph";
import type { TagRelation } from "../types";

function rel(parentId: number, childId: number): TagRelation {
  return { parentId, childId };
}

function sortedNums(values: Iterable<number>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

// ── buildChildrenMap / buildParentsMap：邻接表构建 ─────────────────────────

test("buildChildrenMap：同一父的多个子聚合到同一 key，按关系顺序排列", () => {
  const map = buildChildrenMap([rel(1, 2), rel(1, 3), rel(2, 4)]);
  assert.deepEqual(map.get(1), [2, 3]);
  assert.deepEqual(map.get(2), [4]);
  assert.equal(map.get(4), undefined);
});

test("buildParentsMap：多继承——一个子节点可有多个父", () => {
  const map = buildParentsMap([rel(1, 3), rel(2, 3)]);
  assert.deepEqual(sortedNums(map.get(3) ?? []), [1, 2]);
});

test("buildChildrenMap / buildParentsMap：空关系数组返回空表", () => {
  assert.equal(buildChildrenMap([]).size, 0);
  assert.equal(buildParentsMap([]).size, 0);
});

// ── buildDescendantsMap：后代闭包 ──────────────────────────────────────────

test("buildDescendantsMap：单链闭包 A→B→C，各节点闭包随深度递减", () => {
  const map = buildDescendantsMap([rel(1, 2), rel(2, 3)]);
  assert.deepEqual(sortedNums(map.get(1) ?? []), [1, 2, 3]);
  assert.deepEqual(sortedNums(map.get(2) ?? []), [2, 3]);
  assert.deepEqual(sortedNums(map.get(3) ?? []), [3]);
});

test("buildDescendantsMap：钻石型 DAG（1→2,1→3,2→4,3→4）汇合处去重", () => {
  const map = buildDescendantsMap([rel(1, 2), rel(1, 3), rel(2, 4), rel(3, 4)]);
  assert.deepEqual(sortedNums(map.get(1) ?? []), [1, 2, 3, 4]);
  assert.deepEqual(sortedNums(map.get(2) ?? []), [2, 4]);
  assert.deepEqual(sortedNums(map.get(4) ?? []), [4]);
});

test("buildDescendantsMap：未参与任何关系的标签不出现在结果中（由调用方回退为自身）", () => {
  const map = buildDescendantsMap([rel(1, 2)]);
  assert.equal(map.has(99), false);
});

test("buildDescendantsMap：自环防御——不死循环，返回含自身的集合", () => {
  const map = buildDescendantsMap([rel(1, 1)]);
  assert.ok(map.get(1)?.has(1));
});

test("buildDescendantsMap：二元环防御（A→B→A）不死循环，双方闭包互相包含", () => {
  // 后端已保证标签关系无环，这里仅验证异常数据不会导致递归挂起。
  const map = buildDescendantsMap([rel(1, 2), rel(2, 1)]);
  assert.ok(map.get(1)?.has(1));
  assert.ok(map.get(1)?.has(2));
  assert.ok(map.get(2)?.has(1));
  assert.ok(map.get(2)?.has(2));
});

test("buildDescendantsMap：三元环防御（A→B→C→A）不死循环", () => {
  const map = buildDescendantsMap([rel(1, 2), rel(2, 3), rel(3, 1)]);
  for (const id of [1, 2, 3]) {
    const closure = map.get(id);
    assert.ok(closure, `节点 ${id} 应有闭包结果`);
    assert.ok(closure!.size >= 1);
  }
});

// ── computeLayers：DAG 分层（关系图视图布局）──────────────────────────────

test("computeLayers：单链层级随深度递增，根为第 0 层", () => {
  const layers = computeLayers([1, 2, 3], [rel(1, 2), rel(2, 3)]);
  assert.equal(layers.get(1), 0);
  assert.equal(layers.get(2), 1);
  assert.equal(layers.get(3), 2);
});

test("computeLayers：钻石型 DAG 取最长路径深度（非最短路径）", () => {
  // 1→2→4 与 1→3→4 两条路径长度相同：4 的层级 = 2
  const layers = computeLayers([1, 2, 3, 4], [rel(1, 2), rel(1, 3), rel(2, 4), rel(3, 4)]);
  assert.equal(layers.get(1), 0);
  assert.equal(layers.get(4), 2);
});

test("computeLayers：不等长汇合路径取较长者的深度", () => {
  // 1→4（直连，深度1） 与 1→2→3→4（深度3）汇合于 4：取较大值 3
  const layers = computeLayers([1, 2, 3, 4], [rel(1, 4), rel(1, 2), rel(2, 3), rel(3, 4)]);
  assert.equal(layers.get(4), 3);
});

test("computeLayers：孤立节点（不出现在任何关系中）层级为 0", () => {
  const layers = computeLayers([99], []);
  assert.equal(layers.get(99), 0);
});

// ── orderLayersByBarycenter：层内排序减少边交叉 ────────────────────────────

test("orderLayersByBarycenter：空输入返回空数组", () => {
  assert.deepEqual(orderLayersByBarycenter([], []), []);
});

test("orderLayersByBarycenter：单链保持原有顺序", () => {
  const ordered = orderLayersByBarycenter([[1], [2], [3]], [rel(1, 2), rel(2, 3)]);
  assert.deepEqual(ordered, [[1], [2], [3]]);
});

test("orderLayersByBarycenter：钻石型 DAG 的汇合子节点居中对齐", () => {
  // 输入：L0=[1], L1=[2,3], L2=[4]；关系 1→2, 1→3, 2→4, 3→4
  // 4 的重心 = (0+1)/2 = 0.5，已在 2 和 3 中间；2 和 3 的重心都是 0，保持原顺序。
  const ordered = orderLayersByBarycenter(
    [[1], [2, 3], [4]],
    [rel(1, 2), rel(1, 3), rel(2, 4), rel(3, 4)],
  );
  assert.deepEqual(ordered, [[1], [2, 3], [4]]);
});

test("orderLayersByBarycenter：左右父节点分别拉向对应子节点", () => {
  // 结构：L0=[10,11], L1=[20,21]；关系 10→20, 11→21
  // 输入已是最优，验证保持。
  const ordered = orderLayersByBarycenter(
    [[10, 11], [20, 21]],
    [rel(10, 20), rel(11, 21)],
  );
  assert.deepEqual(ordered, [[10, 11], [20, 21]]);
});

test("orderLayersByBarycenter：交叉边会被重排以减少交叉", () => {
  // 结构：L0=[1,2], L1=[3,4]；关系 1→4, 2→3（交叉）
  // 最优应为 [1,2] 在上，[4,3] 在下，或反过来； barycenter 会把 3/4 拉到对应父节点下方。
  const ordered = orderLayersByBarycenter(
    [[1, 2], [3, 4]],
    [rel(1, 4), rel(2, 3)],
  );
  assert.deepEqual(ordered[0], [1, 2]);
  // 下层节点 4 的重心来自父 1（索引 0），节点 3 的重心来自父 2（索引 1），因此下层应为 [4, 3]
  assert.deepEqual(ordered[1], [4, 3]);
});

test("orderLayersByBarycenter：孤立节点保持输入顺序", () => {
  const ordered = orderLayersByBarycenter([[1, 2, 3]], []);
  assert.deepEqual(ordered, [[1, 2, 3]]);
});

await run("tagGraph");
