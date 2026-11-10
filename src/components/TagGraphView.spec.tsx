import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagGraphView } from "./TagGraphView";
import { useAppStore } from "../stores/appStore";
import type { Tag } from "../types";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const tag = (id: number, name: string): Tag => ({ id, name, color: "#3366ff" } as Tag);

describe("层级图谱：选中高亮全部后代", () => {
  beforeEach(() => {
    useAppStore.setState({
      tags: [tag(1, "游戏"), tag(2, "RPG"), tag(3, "JRPG"), tag(4, "无关")],
      tagRelations: [{ parentId: 1, childId: 2 }, { parentId: 2, childId: 3 }],
    });
  });

  it("点父标签后，孙标签也高亮、无关标签淡化", async () => {
    const { container } = render(<TagGraphView dataEpoch={0} />);
    const node = (id: number) => container.querySelector(`[data-graph-node-id="${id}"]`) as HTMLElement;
    // 打开时默认选中子节点最多的标签（可能就是 1）；未选中才点
    if (node(1).getAttribute("aria-pressed") !== "true") await userEvent.click(node(1));
    expect(node(1)).toHaveAttribute("data-graph-relation", "selected");
    expect(node(2)).toHaveAttribute("data-graph-relation", "child");
    expect(node(3)).toHaveAttribute("data-graph-relation", "descendant");
    expect(node(4)).not.toHaveAttribute("data-graph-relation");
    expect(node(4).className).toContain("opacity-55");
    expect(node(3).className).not.toContain("opacity-55");
    expect(screen.getByTestId("graph-descendant-count")).toHaveTextContent("共 2 个后代标签");
  });
});
