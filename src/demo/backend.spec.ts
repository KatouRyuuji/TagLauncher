import { expect, it } from "vitest";
import { handleInvoke } from "./backend";
import type { ItemWithTags } from "../types";

it("演示模式读取项目时保留用户保存的标签顺序", async () => {
  const original = await handleInvoke<ItemWithTags>("get_item", { id: 7 });
  const reordered = [...original.tags.map((tag) => tag.id)].reverse();
  try {
    await handleInvoke("set_item_tags", { itemId: 7, tagIds: reordered });
    const item = await handleInvoke<ItemWithTags>("get_item", { id: 7 });
    expect(item.tags.map((tag) => tag.id)).toEqual(reordered);
  } finally {
    await handleInvoke("set_item_tags", { itemId: 7, tagIds: original.tags.map((tag) => tag.id) });
  }
});
