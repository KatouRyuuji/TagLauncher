import { assert, test, run } from "./__testutil";
import { selectAutoTagTargets } from "./autoTagTargets";
import type { ItemWithTags } from "../types";

const it = (id: number, tags: number = 0) =>
  ({ id, name: `i${id}`, tags: Array.from({ length: tags }, (_, k) => ({ id: k + 1, name: `t${k}` })) }) as unknown as ItemWithTags;

test("BUG-17：快照尚未包含新对象时仍选中（回退排队对象）", () => {
  assert.deepEqual(selectAutoTagTargets([it(1), it(2)], []).map((x) => x.id), [1, 2]);
});

test("快照中已打标的对象被跳过", () => {
  assert.deepEqual(selectAutoTagTargets([it(1), it(2)], [it(1, 2)]).map((x) => x.id), [2]);
});

test("去重且保持顺序", () => {
  assert.deepEqual(selectAutoTagTargets([it(3), it(1), it(3)], [it(1)]).map((x) => x.id), [3, 1]);
});

test("排队时已带标签的对象不打标", () => {
  assert.deepEqual(selectAutoTagTargets([it(5, 1)], []), []);
});

await run("autoTagTargets");
