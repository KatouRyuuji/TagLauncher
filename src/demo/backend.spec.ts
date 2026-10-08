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

it("演示模式批量重命名支持同目录互换，并能换回", async () => {
  type Report = { renamed: { id: number }[]; failed: { id: number; error: string }[] };
  const before = await Promise.all([9, 10].map((id) => handleInvoke<ItemWithTags>("get_item", { id })));
  const occupied = await handleInvoke<Report>("rename_items", { renames: [{ id: 9, newName: "Git批量更新.ps1" }], dryRun: true });
  expect(occupied.failed).toEqual([{ id: 9, error: "「Git批量更新.ps1」已存在" }]);
  try {
    const swap = await handleInvoke<Report>("rename_items", {
      renames: [{ id: 9, newName: "Git批量更新.ps1" }, { id: 10, newName: "启动开发环境.bat" }],
      dryRun: false,
    });
    expect(swap.failed).toEqual([]);
    const swapped = await Promise.all([9, 10].map((id) => handleInvoke<ItemWithTags>("get_item", { id })));
    expect(swapped.map((item) => item.path)).toEqual([before[1].path, before[0].path]);
  } finally {
    await handleInvoke("rename_items", {
      renames: [{ id: 9, newName: "启动开发环境.bat" }, { id: 10, newName: "Git批量更新.ps1" }],
      dryRun: false,
    });
  }
  const restored = await Promise.all([9, 10].map((id) => handleInvoke<ItemWithTags>("get_item", { id })));
  expect(restored.map((item) => item.path)).toEqual(before.map((item) => item.path));
});
