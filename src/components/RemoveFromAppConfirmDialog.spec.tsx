// ============================================================================
// src/components/RemoveFromAppConfirmDialog.spec.tsx — 移除确认：不再追踪
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoveFromAppConfirmDialog } from "./RemoveFromAppConfirmDialog";

const items = [{ name: "Sub", path: "D:\\Photos\\Sub", type: "folder" }];

function renderDialog(untrack = { untrackedCount: 0, extraIds: [] as number[] }) {
  const onConfirm = vi.fn(async () => {});
  render(
    <RemoveFromAppConfirmDialog
      open
      items={items}
      skipNextTime={false}
      preferDeleteFiles={false}
      untrack={untrack}
      onSkipNextTimeChange={vi.fn()}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("RemoveFromAppConfirmDialog", () => {
  it("普通对象：从库中移除，可勾选不再询问", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "从库中移除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /不再询问/ })).toBeInTheDocument();
  });

  it("监视 / 关联文件夹内：改为不再追踪，写明连带项且不可跳过确认", async () => {
    const onConfirm = renderDialog({ untrackedCount: 1, extraIds: [4, 5, 6] });
    expect(screen.getByText(/之后也不会自动导入/)).toHaveTextContent("连同其下已入库的 3 项一起移出");
    expect(screen.queryByRole("button", { name: /不再询问/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "不再追踪" }));
    expect(onConfirm).toHaveBeenCalledWith("library");
  });
});
