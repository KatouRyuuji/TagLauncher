// 失效项目对话框：全盘找回与「在选定文件夹中找回」两条入口的参数口径
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissingItemsReviewDialog } from "./MissingItemsReviewDialog";
import type { ItemWithTags } from "../types";

const items: ItemWithTags[] = [
  { id: 1, name: "失效.txt", path: "E:\\a\\失效.txt", type: "file", created_at: "2026-01-01T00:00:00Z", is_favorite: false, is_missing: true, tags: [] },
];

function setup(pick: () => Promise<string[] | null>) {
  const onRelocate = vi.fn(async (_roots?: string[]) => {});
  render(
    <MissingItemsReviewDialog
      open
      items={items}
      relocating={false}
      lastRelocateResult={null}
      onClose={() => {}}
      onRelocate={onRelocate}
      onPickRelocateRoots={pick}
      onRemove={async () => {}}
    />,
  );
  return onRelocate;
}

describe("MissingItemsReviewDialog 找回范围", () => {
  it("全部找回不带范围（全盘，原行为）", () => {
    const onRelocate = setup(async () => null);
    fireEvent.click(screen.getByRole("button", { name: "尝试找回全部失效项" }));
    expect(onRelocate).toHaveBeenCalledTimes(1);
    expect(onRelocate.mock.calls[0]).toEqual([]);
  });

  it("选定文件夹后只在这些文件夹内找回", async () => {
    const onRelocate = setup(async () => ["D:\\Games", "E:\\Tools"]);
    fireEvent.click(screen.getByRole("button", { name: "在选定文件夹中找回…" }));
    await waitFor(() => expect(onRelocate).toHaveBeenCalledWith(["D:\\Games", "E:\\Tools"]));
  });

  it("取消选择不触发扫描", async () => {
    const pick = vi.fn(async () => null);
    const onRelocate = setup(pick);
    fireEvent.click(screen.getByRole("button", { name: "在选定文件夹中找回…" }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(onRelocate).not.toHaveBeenCalled();
  });
});
