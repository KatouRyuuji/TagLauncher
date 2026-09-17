import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useAppStore } from "../stores/appStore";

describe("快捷键速查表", () => {
  beforeEach(() => {
    useAppStore.setState({ shortcutsHelpOpen: true });
  });

  afterEach(() => {
    useAppStore.setState({ shortcutsHelpOpen: false });
  });

  it("默认仍能看到 F3，并可按动作或键名过滤", async () => {
    render(<ShortcutsHelp />);
    expect(screen.getByText(/F3/)).toBeInTheDocument();
    const input = screen.getByRole("searchbox", { name: "搜索快捷键" });
    expect(input).toHaveAttribute("placeholder", "搜快捷键或动作");
    await userEvent.type(input, "ctrl+k");
    expect(screen.getByText("命令面板")).toBeInTheDocument();
    expect(screen.queryByText("聚焦搜索")).not.toBeInTheDocument();
    expect(screen.queryByText("选择与整理")).not.toBeInTheDocument();
  });

  it("全空时显示没有匹配的快捷键", async () => {
    render(<ShortcutsHelp />);
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索快捷键" }), "zzzz");
    expect(screen.getByText("没有匹配的快捷键")).toBeInTheDocument();
    expect(screen.queryByText(/F3/)).not.toBeInTheDocument();
  });

  it("Esc 先清空搜索，再关帮助", async () => {
    render(<ShortcutsHelp />);
    const input = screen.getByRole("searchbox", { name: "搜索快捷键" });
    await userEvent.type(input, "zzzz");
    expect(screen.getByText("没有匹配的快捷键")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(useAppStore.getState().shortcutsHelpOpen).toBe(true);
    expect(screen.getByText(/F3/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().shortcutsHelpOpen).toBe(false);
  });
});
