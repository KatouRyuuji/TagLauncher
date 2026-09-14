import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { TagEditor } from "./TagEditor";
import { ItemTagsEditor } from "./ItemTagsEditor";
import type { ItemWithTags } from "../types";

describe("分类编辑器状态", () => {
  it("名称反映真实分类类型，保存期间防止重复提交和退出", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const close = vi.fn();
    render(<TagEditor tag={null} label="文件柜" onSave={save} onClose={close} />);
    expect(screen.getByRole("dialog", { name: "新建文件柜" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "工作");
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "名称" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  });

  it("取消删除确认后返回原按钮，保留键盘焦点", async () => {
    const remove = vi.fn();
    render(<TagEditor tag={{ id: 1, name: "工作", color: "#5064d8" }} onSave={vi.fn()} onDelete={remove} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "删除", exact: true }));
    expect(screen.getByRole("button", { name: "确认删除" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "保存", exact: true })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(screen.getByRole("button", { name: "删除", exact: true })).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
  });

  it("新标签创建完成前保持编辑器，阻止重复请求", async () => {
    let finish!: (ids: number[]) => void;
    const create = vi.fn(() => new Promise<number[]>((resolve) => { finish = resolve; }));
    const close = vi.fn();
    const item: ItemWithTags = { id: 1, name: "文件", path: "D:/file.txt", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] };
    render(<ItemTagsEditor item={item} tags={[]} onSave={vi.fn()} onAddNewTag={create} onClose={close} />);
    await userEvent.type(screen.getByRole("textbox", { name: "新标签名称" }), "工作");
    await userEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => finish([1]));
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  });
});
