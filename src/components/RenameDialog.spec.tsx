import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenameDialog } from "./RenameDialog";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("../lib/db", () => ({ renameItems: vi.fn() }));

const file: ItemWithTags = { id: 3, name: "报告.docx", path: "D:\\报告.docx", type: "exe", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [] };
const folder: ItemWithTags = { id: 4, name: "v1.2 资料", path: "D:\\v1.2 资料", type: "folder", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [] };

function input() {
  return screen.getByRole("textbox", { name: "新名称" }) as HTMLInputElement;
}

describe("重命名弹窗", () => {
  beforeEach(() => {
    vi.mocked(db.renameItems).mockReset();
    vi.mocked(db.renameItems).mockResolvedValue({ renamed: [], failed: [] });
  });

  it("文件预填原名并只选中主名，Enter 保存后关闭", async () => {
    const save = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    render(<RenameDialog item={file} onSave={save} onClose={close} />);
    expect(input()).toHaveFocus();
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 2]);
    fireEvent.change(input(), { target: { value: "周报.docx" } });
    await waitFor(() => expect(db.renameItems).toHaveBeenCalledWith([{ id: 3, newName: "周报.docx" }], true));
    await userEvent.keyboard("{Enter}");
    expect(save).toHaveBeenCalledWith("周报.docx");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("文件夹选中整个名称", () => {
    render(<RenameDialog item={folder} onSave={vi.fn()} onClose={vi.fn()} />);
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, folder.name.length]);
  });

  it("预检失败时显示后端原因并禁止保存", async () => {
    vi.mocked(db.renameItems).mockResolvedValue({ renamed: [], failed: [{ id: 3, error: "「旧.docx」已存在" }] });
    const save = vi.fn(() => Promise.resolve());
    render(<RenameDialog item={file} onSave={save} onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "旧.docx" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("「旧.docx」已存在");
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(save).not.toHaveBeenCalled();
  });

  it("修改扩展名时提示类型可能变化", () => {
    render(<RenameDialog item={file} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "报告.pdf" } });
    expect(screen.getByText("扩展名已修改，类型可能变化")).toBeInTheDocument();
  });

  it("名称未变直接关闭不提交；保存失败时保持打开，Esc 取消", async () => {
    const save = vi.fn(() => Promise.reject(new Error("文件正被其他程序占用")));
    const close = vi.fn();
    render(<RenameDialog item={file} onSave={save} onClose={close} />);
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(save).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);

    fireEvent.change(input(), { target: { value: "新.docx" } });
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(save).toHaveBeenCalledWith("新.docx");
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(2);
  });
});
