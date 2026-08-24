// ============================================================================
// src/components/BatchSelectionToolbar.spec.tsx — 批量操作进行中状态测试
// ============================================================================
// 批量写库操作有可感知耗时：进行中必须禁用全部操作入口防止重复提交，
// 并以 aria-busy + spinner 提供"正在执行"的可感知反馈；完成后恢复可用。
// ============================================================================

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchSelectionToolbar } from "./BatchSelectionToolbar";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderToolbar(overrides: Partial<React.ComponentProps<typeof BatchSelectionToolbar>> = {}) {
  return render(
    <BatchSelectionToolbar
      selectedCount={3}
      totalCount={10}
      tags={[{ id: 1, name: "游戏", color: "#3b82f6" }]}
      removableTags={[]}
      cabinets={[]}
      canRemoveFromCabinet={false}
      onAddTag={async () => {}}
      onRemoveTag={async () => {}}
      onAddToCabinet={async () => {}}
      onRemoveFromCabinet={async () => {}}
      onRemoveFromApp={async () => {}}
      favoriteLabel="收藏"
      onToggleFavorite={() => {}}
      onCopyPaths={() => {}}
      onSelectAll={() => {}}
      onClearSelection={() => {}}
      {...overrides}
    />,
  );
}

describe("BatchSelectionToolbar 批量操作进行中状态", () => {
  it("批量删除进行中：aria-busy=true、spinner 可见、全部操作按钮禁用", async () => {
    const user = userEvent.setup();
    const { promise, resolve } = deferred();
    renderToolbar({ onRemoveFromApp: () => promise });

    await user.click(screen.getByRole("button", { name: "批量删除" }));

    expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("batch-busy-spinner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量删除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "加入标签" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /收藏/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "复制路径" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消选择" })).toBeDisabled();

    resolve();
    await waitFor(() => {
      expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "false");
    });
  });

  it("操作完成（含失败）后恢复可用，不残留禁用态", async () => {
    const user = userEvent.setup();
    renderToolbar({ onRemoveFromApp: async () => { throw new Error("后端失败"); } });

    await user.click(screen.getByRole("button", { name: "批量删除" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "批量删除" })).toBeEnabled();
    });
    expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "false");
  });

  it("进行中重复点击不触发第二次调用", async () => {
    const user = userEvent.setup();
    const { promise, resolve } = deferred();
    let calls = 0;
    renderToolbar({
      onRemoveFromApp: () => {
        calls += 1;
        return promise;
      },
    });

    const removeButton = screen.getByRole("button", { name: "批量删除" });
    await user.click(removeButton);
    // disabled 按钮点击不触发，但仍模拟用户狂点
    await user.click(removeButton).catch(() => {});
    expect(calls).toBe(1);

    resolve();
    await waitFor(() => expect(removeButton).toBeEnabled());
  });

  it("菜单动作（加入标签）同样进入进行中状态", async () => {
    const user = userEvent.setup();
    const { promise, resolve } = deferred();
    renderToolbar({ onAddTag: () => promise });

    await user.click(screen.getByRole("button", { name: "加入标签" }));
    await user.click(screen.getByRole("menuitem", { name: /游戏/ }));

    expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "true");

    resolve();
    await waitFor(() => {
      expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "false");
    });
  });
});
