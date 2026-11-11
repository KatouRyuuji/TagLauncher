import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("文件柜新建标题下强调分组用途，并列出可识别的颜色选项", () => {
    render(<TagEditor tag={null} label="文件柜" onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "新建文件柜" })).toBeInTheDocument();
    expect(screen.getByText("文件柜是分组，一个对象可以进多个柜；柜可以放进另一个柜（父柜默认显示全部子柜内容）；也可以关联一个磁盘文件夹，柜内容随文件夹同步")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "分类颜色" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "蔷薇" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "晴蓝" })).toHaveAttribute("aria-checked", "true");
  });

  it("文件柜可选上级文件柜（F16），保存时带回 parentId；有子柜时不提供关联文件夹", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TagEditor
        tag={{ id: 3, name: "子", color: "#3b82f6" }}
        label="文件柜"
        folderPath={null}
        parentId={null}
        parentOptions={[{ id: 1, label: "工作" }, { id: 2, label: "工作 / 项目" }]}
        hasChildren
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByTestId("cabinet-parent-select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["（顶层）", "工作", "工作 / 项目"]);
    expect(screen.getByTestId("cabinet-folder-blocked")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.submit(select.closest("form")!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("子", expect.any(String), null, 2));
  });

  it("标签编辑器不显示上级文件柜字段，保存不带 parentId", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TagEditor tag={{ id: 1, name: "工作", color: "#3b82f6" }} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.queryByTestId("cabinet-parent-select")).toBeNull();
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("工作", expect.any(String), null, undefined));
  });

  it("现有色不在主题色板里时立刻吸附最近位，不出现当前点", () => {
    render(<TagEditor tag={{ id: 1, name: "工作", color: "#111111" }} onSave={vi.fn()} onClose={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "分类颜色" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(10);
    expect(screen.queryByRole("radio", { name: "当前" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { checked: true })).toBeInTheDocument();
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
