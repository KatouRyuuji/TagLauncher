import { assert, test, run } from "./__testutil";
import { applySortOrder, compareSortOrder, moveBeside } from "./sidebarOrder";

test("手动顺序：升序，缺省视为 0，相同值交给调用方", () => {
  assert.equal(compareSortOrder({ sort_order: 1 }, { sort_order: 2 }) < 0, true);
  assert.equal(compareSortOrder({}, { sort_order: 0 }), 0);
  assert.equal(compareSortOrder({ sort_order: 1 }, {}) > 0, true);
});

test("移动：放到目标之前或之后，无效输入返回 null", () => {
  assert.deepEqual(moveBeside([1, 2, 3, 4], 4, 2, false), [1, 4, 2, 3]);
  assert.deepEqual(moveBeside([1, 2, 3, 4], 1, 3, true), [2, 3, 1, 4]);
  assert.deepEqual(moveBeside([1, 2, 3], 2, 3, false), [1, 2, 3]);
  assert.equal(moveBeside([1, 2], 1, 1, true), null);
  assert.equal(moveBeside([1, 2], 9, 1, true), null);
});

test("回填：按新顺序写 1 起的 sort_order 并重排", () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = applySortOrder(list, [3, 1, 2]);
  assert.deepEqual(next.map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(next.map((entry) => entry.sort_order), [1, 2, 3]);
});

await run("sidebarOrder");
