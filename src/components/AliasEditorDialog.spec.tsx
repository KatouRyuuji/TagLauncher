import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AliasEditorDialog } from "./AliasEditorDialog";
import type { ItemWithTags } from "../types";

const item: ItemWithTags = {
  id: 7,
  name: "setup_x64.exe",
  path: "D:\\Tools\\setup_x64.exe",
  type: "exe",
  created_at: "2026-01-01 00:00:00",
  is_favorite: false,
  alias: null,
  tags: [],
};

describe("显示别名弹窗", () => {
  it("显示磁盘名，Enter 保存别名后关闭", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AliasEditorDialog item={item} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText("setup_x64.exe")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "显示别名" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "安装器{Enter}");
    expect(onSave).toHaveBeenCalledWith("安装器");
    expect(onClose).toHaveBeenCalled();
  });

  it("超长禁止保存，不截断", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AliasEditorDialog item={{ ...item, alias: "长".repeat(121) }} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByText("121 / 120")).toBeInTheDocument();
  });

  it("保存失败保持打开", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("x"));
    const onClose = vi.fn();
    render(<AliasEditorDialog item={item} onSave={onSave} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});
