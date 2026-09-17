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
      selectedItems={[]}
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

describe("BatchSelectionToolbar 覆盖层让位", () => {
  it("suppressed 时不渲染，避免键盘可达", () => {
    renderToolbar({ suppressed: true });
    expect(screen.queryByTestId("batch-toolbar")).not.toBeInTheDocument();
  });

  it("非 suppressed 时仍有 batch-toolbar，选中计数保留", () => {
    renderToolbar({ selectedCount: 11 });
    expect(screen.getByTestId("batch-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("batch-toolbar").textContent).toContain("11");
    expect(screen.getByTestId("batch-toolbar").textContent).toContain("已选中");
  });
});

describe("BatchSelectionToolbar 加入标签已有态", () => {
  it("将加到 N 个对象；全有显示勾；部分显示 k/N", async () => {
    const user = userEvent.setup();
    const selectedItems = Array.from({ length: 11 }, (_, index) => ({
      tags: index < 3 ? [{ id: 1 }, { id: 2 }] : [{ id: 1 }],
    }));
    renderToolbar({
      selectedCount: 11,
      tags: [
        { id: 1, name: "游戏", color: "#3b82f6" },
        { id: 2, name: "开发", color: "#22c55e" },
      ],
      selectedItems,
    });

    await user.click(screen.getByRole("button", { name: "加入标签" }));

    expect(screen.getByText("将加到 11 个对象")).toBeInTheDocument();

    const owned = screen.getByRole("menuitem", { name: /^游戏/ });
    expect(owned).toHaveAttribute("title", "已全部拥有");
    expect(owned.querySelector("svg")).not.toBeNull();

    const partial = screen.getByRole("menuitem", { name: /开发/ });
    expect(partial.textContent).toContain("3/11");
    expect(screen.getByText("3/11")).toBeInTheDocument();
  });
});

describe("BatchSelectionToolbar 批量操作进行中状态", () => {
  it("从库中移除进行中：aria-busy=true、spinner 可见、全部操作按钮禁用", async () => {
    const user = userEvent.setup();
    const { promise, resolve } = deferred();
    renderToolbar({ onRemoveFromApp: () => promise });

    await user.click(screen.getByRole("button", { name: "从库中移除" }));

    expect(screen.getByTestId("batch-toolbar")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("batch-busy-spinner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从库中移除" })).toBeDisabled();
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

    await user.click(screen.getByRole("button", { name: "从库中移除" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "从库中移除" })).toBeEnabled();
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

    const removeButton = screen.getByRole("button", { name: "从库中移除" });
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
