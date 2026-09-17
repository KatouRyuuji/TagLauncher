import { assert, test, run } from "./__testutil";
import { summarizeTagOwnership } from "./tagOwnership";

function item(tagIds: number[]) {
  return { tags: tagIds.map((id) => ({ id })) };
}

test("summarizeTagOwnership：全有 / 部分 / 都没有", () => {
  const selected = [item([1, 2]), item([1]), item([1, 3])];
  assert.deepEqual(summarizeTagOwnership(selected, 1), { have: 3, total: 3 });
  assert.deepEqual(summarizeTagOwnership(selected, 2), { have: 1, total: 3 });
  assert.deepEqual(summarizeTagOwnership(selected, 9), { have: 0, total: 3 });
});

test("summarizeTagOwnership：空选中计数为 0/0", () => {
  assert.deepEqual(summarizeTagOwnership([], 1), { have: 0, total: 0 });
});

await run("tagOwnership");
