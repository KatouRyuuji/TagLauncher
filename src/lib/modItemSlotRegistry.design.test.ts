import { assert, test, run } from "./__testutil";
import {
  registerItemSlot,
  unregisterItemSlot,
  unregisterAllItemSlots,
  getItemSlotsForPosition,
  getAllItemSlots,
  subscribeItemSlots,
} from "./modItemSlotRegistry";
import type { ItemWithTags } from "../types";

const noopRender = (_item: ItemWithTags) => ({}) as HTMLElement;

test("registerItemSlot：注册后可通过 getAllItemSlots 取回，字段一致", () => {
  registerItemSlot("modA", "slot1", "footer", noopRender);
  const found = getAllItemSlots().find((s) => s.modId === "modA" && s.id === "slot1");
  assert.ok(found);
  assert.equal(found!.position, "footer");
  unregisterAllItemSlots("modA");
});

test("getItemSlotsForPosition：按 position 过滤，header/footer/actions 互不干扰", () => {
  registerItemSlot("modB", "h1", "header", noopRender);
  registerItemSlot("modB", "f1", "footer", noopRender);
  registerItemSlot("modB", "a1", "actions", noopRender);

  assert.deepEqual(getItemSlotsForPosition("header").map((s) => s.id), ["h1"]);
  assert.deepEqual(getItemSlotsForPosition("footer").map((s) => s.id), ["f1"]);
  assert.deepEqual(getItemSlotsForPosition("actions").map((s) => s.id), ["a1"]);

  unregisterAllItemSlots("modB");
});

test("registerItemSlot：相同 modId+slotId 二次注册覆盖而非追加", () => {
  registerItemSlot("modC", "slot1", "header", noopRender);
  registerItemSlot("modC", "slot1", "footer", noopRender);
  const matches = getAllItemSlots().filter((s) => s.modId === "modC" && s.id === "slot1");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].position, "footer");
  unregisterAllItemSlots("modC");
});

test("unregisterItemSlot：按 modId+slotId 精确移除", () => {
  registerItemSlot("modD", "slot1", "header", noopRender);
  unregisterItemSlot("modD", "slot1");
  assert.equal(getAllItemSlots().some((s) => s.modId === "modD"), false);
});

test("unregisterAllItemSlots：仅移除该 mod 名下的插槽，不影响其它 mod", () => {
  registerItemSlot("modE", "s1", "header", noopRender);
  registerItemSlot("modF", "s1", "header", noopRender);
  unregisterAllItemSlots("modE");
  assert.equal(getAllItemSlots().some((s) => s.modId === "modE"), false);
  assert.equal(getAllItemSlots().some((s) => s.modId === "modF"), true);
  unregisterAllItemSlots("modF");
});

test("subscribeItemSlots：注册/注销触发订阅回调，取消订阅后不再触发", () => {
  let calls = 0;
  const unsubscribe = subscribeItemSlots(() => { calls += 1; });

  registerItemSlot("modG", "slot1", "header", noopRender);
  assert.equal(calls, 1);

  unregisterItemSlot("modG", "slot1");
  assert.equal(calls, 2);

  unsubscribe();
  registerItemSlot("modG", "slot1", "header", noopRender);
  assert.equal(calls, 2); // 取消订阅后不再增加
  unregisterAllItemSlots("modG");
});

await run("modItemSlotRegistry");
