import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BatchRenameDialog } from "./BatchRenameDialog";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";
import { useAppStore } from "../stores/appStore";

vi.mock("../lib/db", () => ({ renameItems: vi.fn() }));

function item(id: number, name: string, extra: Partial<ItemWithTags> = {}): ItemWithTags {
  return { id, name, path: `D:\\资料\\${name}`, type: "document", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [], ...extra };
}

const items = [item(1, "报告-草稿.docx"), item(2, "清单-草稿.xlsx"), item(3, "旧-草稿.txt", { is_missing: true }), item(4, "备忘.txt")];

function rows() {
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
}

describe("批量重命名弹窗", () => {
  beforeEach(() => {
    vi.mocked(db.renameItems).mockReset();
    vi.mocked(db.renameItems).mockResolvedValue({ renamed: [], failed: [] });
    useAppStore.setState({ lastBatchRename: null });
  });

  it("查找替换预览：失效跳过、不变、后端校验失败都在状态列，执行只提交可改名的行", async () => {
    vi.mocked(db.renameItems).mockImplementation(async (renames, dryRun) =>
      dryRun ? { renamed: [], failed: [{ id: 2, error: "「清单-定稿.xlsx」已存在" }] } : { renamed: renames.map((r) => ({ id: r.id, oldPath: "", newPath: "" })), failed: [] },
    );
    const execute = vi.fn(async (renames: Array<{ id: number; newName: string }>) => ({ renamed: renames.map((r) => ({ id: r.id, oldPath: "", newPath: "" })), failed: [] }));
    render(<BatchRenameDialog items={items} onExecute={execute} onUndo={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "查找" }), { target: { value: "草稿" } });
    fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), { target: { value: "定稿" } });
    await waitFor(() => expect(db.renameItems).toHaveBeenCalledWith([{ id: 1, newName: "报告-定稿.docx" }, { id: 2, newName: "清单-定稿.xlsx" }], true));
    await waitFor(() => expect(rows()[1][2]).toBe("「清单-定稿.xlsx」已存在"));
    expect(rows().map((row) => row[2])).toEqual(["将改名", "「清单-定稿.xlsx」已存在", "失效，跳过", "不变"]);

    await userEvent.click(screen.getByRole("button", { name: "执行（1）" }));
    expect(execute).toHaveBeenCalledWith([{ id: 1, newName: "报告-定稿.docx" }]);
    expect(await screen.findByText("成功 1 / 失败 0")).toBeInTheDocument();
    expect(useAppStore.getState().lastBatchRename).toEqual([{ id: 1, oldName: "报告-草稿.docx" }]);
  });

  it("模板按显示顺序编号，失效项不占序号；错误正则只提示不执行", async () => {
    render(<BatchRenameDialog items={items} onExecute={vi.fn()} onUndo={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "规则类型" }));
    await userEvent.click(screen.getByRole("option", { name: "模板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板" }), { target: { value: "{n}_{name}" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "序号补零位数" }), { target: { value: "2" } });
    expect(rows().map((row) => row[1])).toEqual(["01_报告-草稿.docx", "02_清单-草稿.xlsx", "旧-草稿.txt", "03_备忘.txt"]);

    await userEvent.click(screen.getByRole("button", { name: "规则类型" }));
    await userEvent.click(screen.getByRole("option", { name: "查找替换" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "正则表达式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "查找" }), { target: { value: "(" } });
    expect(screen.getByRole("alert").textContent).toContain("正则表达式有误");
    expect(screen.getByRole("button", { name: "执行（0）" })).toBeDisabled();
  });

  it("结果摘要列出失败原因，撤销后按钮随撤销记录消失", async () => {
    vi.mocked(db.renameItems).mockResolvedValue({ renamed: [], failed: [] });
    const execute = vi.fn(async () => ({ renamed: [{ id: 1, oldPath: "", newPath: "" }], failed: [{ id: 2, error: "文件被占用" }] }));
    const undo = vi.fn(async () => useAppStore.getState().setLastBatchRename(null));
    render(<BatchRenameDialog items={items} onExecute={execute} onUndo={undo} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "查找" }), { target: { value: "草稿" } });
    await userEvent.click(screen.getByRole("button", { name: "执行（2）" }));
    expect(await screen.findByText("成功 1 / 失败 1")).toBeInTheDocument();
    expect(screen.getByText("清单-草稿.xlsx：文件被占用")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销这次重命名" }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销这次重命名" })).not.toBeInTheDocument());
  });
});
