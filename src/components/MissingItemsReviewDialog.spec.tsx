// 失效项目对话框：全盘找回与「在选定文件夹中找回」两条入口的参数口径
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissingItemsReviewDialog } from "./MissingItemsReviewDialog";
import type { ItemWithTags } from "../types";

const items: ItemWithTags[] = [
  { id: 1, name: "失效.txt", path: "E:\\a\\失效.txt", type: "file", created_at: "2026-01-01T00:00:00Z", is_favorite: false, is_missing: true, tags: [] },
];

function setup(pick: () => Promise<string[] | null>, extra: Partial<Parameters<typeof MissingItemsReviewDialog>[0]> = {}) {
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
      {...extra}
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

  it("扫描进行中显示进度（已扫描 N 万项 / 当前盘 / 用时与上限）并可停止", () => {
    const onStopScan = vi.fn();
    setup(async () => null, {
      scanProgress: { scanId: 1, scanned: 123_456, root: "C:\\", scoped: false, elapsedMs: 65_000, limitMs: 300_000 },
      onStopScan,
    });
    const status = screen.getByTestId("relocate-progress");
    expect(status.textContent).toContain("正在全盘找回：已扫描 12.3 万项（C:\\）· 1:05 / 5:00");
    fireEvent.click(screen.getByRole("button", { name: "停止扫描" }));
    expect(onStopScan).toHaveBeenCalledTimes(1);
  });

  it("停止/超时说明以横幅显示，超时为警示", () => {
    setup(async () => null, { relocateNote: { kind: "warning", text: "扫描超过时间上限（5 分钟，已扫描 9 项）：未完成唯一性核验" } });
    expect(screen.getByRole("alert").textContent).toContain("未完成唯一性核验");
  });
});
