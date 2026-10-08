import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { NOTE_MAX_CHARS, NoteEditorDialog } from "./NoteEditorDialog";
import type { ItemWithTags } from "../types";

const item: ItemWithTags = {
  id: 7,
  name: "记账本",
  path: "D:\\记账本.xlsx",
  type: "file",
  created_at: "2026-10-08 00:00:00",
  is_favorite: false,
  note: "旧备注",
  tags: [],
};

describe("备注编辑弹窗", () => {
  it("预填现有备注，Ctrl+Enter 保存草稿后关闭", async () => {
    const save = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    render(<NoteEditorDialog item={item} onSave={save} onClose={close} />);
    expect(screen.getByRole("dialog", { name: "编辑备注" })).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "备注内容" });
    expect(textarea).toHaveValue("旧备注");
    expect(textarea).toHaveFocus();
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "新备注");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(save).toHaveBeenCalledWith("新备注");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("保存失败时弹窗保持打开以便重试", async () => {
    const save = vi.fn(() => Promise.reject(new Error("磁盘只读")));
    const close = vi.fn();
    render(<NoteEditorDialog item={item} onSave={save} onClose={close} />);
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  });

  it("超过字数上限时禁止保存，Esc 取消不保存", async () => {
    const save = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    render(<NoteEditorDialog item={item} onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "备注内容" }), { target: { value: "字".repeat(NOTE_MAX_CHARS + 1) } });
    expect(screen.getByText(`${NOTE_MAX_CHARS + 1} / ${NOTE_MAX_CHARS}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
