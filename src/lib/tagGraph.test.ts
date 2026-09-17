import { assert, test, run } from "./__testutil";
import { pickDefaultGraphNode } from "./tagGraph";
import type { TagRelation } from "../types";

function rel(parentId: number, childId: number): TagRelation {
  return { parentId, childId };
}

test("pickDefaultGraphNode：没有任何关系时返回 null", () => {
  assert.equal(pickDefaultGraphNode([1, 2, 3], []), null);
  assert.equal(pickDefaultGraphNode([], [rel(1, 2)]), null);
});

test("pickDefaultGraphNode：返回直接子节点最多的标签", () => {
  // 1 有两个直接子，2 只有一个
  assert.equal(
    pickDefaultGraphNode([1, 2, 3, 4], [rel(1, 3), rel(1, 4), rel(2, 3)]),
    1,
  );
});

test("pickDefaultGraphNode：子节点数平局时取 id 较小者", () => {
  // 10 与 2 都只有一个直接子
  assert.equal(
    pickDefaultGraphNode([10, 2, 3, 4], [rel(10, 3), rel(2, 4)]),
    2,
  );
});

await run("tagGraph-pickDefault");
