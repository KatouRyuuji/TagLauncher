import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPreviewBody } from "./FolderPreviewBody";
import type { ItemWithTags } from "../../types";
import * as db from "../../lib/db";

vi.mock("../../lib/db", () => ({
  listObjectDirectory: vi.fn(),
  openObjectPath: vi.fn(),
  openInExplorer: vi.fn(),
}));
vi.mock("../../lib/toast", () => ({ showToast: vi.fn() }));

const root: ItemWithTags = { id: 1, name: "工作文档", path: "D:\\工作文档", type: "folder", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [] };

function dir(path: string): db.ObjectDirectoryEntry {
  return { name: path.split("\\").pop()!, path, item_type: "folder", is_file: false, is_dir: true, size: null };
}

function file(path: string): db.ObjectDirectoryEntry {
  return { name: path.split("\\").pop()!, path, item_type: "file", is_file: true, is_dir: false, size: 1 };
}

const listings: Record<string, db.ObjectDirectoryEntry[]> = {
  "D:\\工作文档": [
    dir("D:\\工作文档\\会议纪要"),
    file("D:\\工作文档\\报告.docx"),
  ],
  "D:\\工作文档\\会议纪要": [file("D:\\工作文档\\会议纪要\\周会.docx")],
};

// jsdom 没有布局，给滚动容器一个可见高度，虚拟列表才会渲染行
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
});
afterAll(() => {
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
});

function list() {
  return screen.getByLabelText("目录内容");
}

function renderBody(onAddItems?: (paths: string[]) => Promise<void>) {
  return render(<FolderPreviewBody item={root} info={null} onTagSelect={vi.fn()} onAddItems={onAddItems} />);
}

describe("文件夹预览下钻", () => {
  beforeEach(() => {
    vi.mocked(db.listObjectDirectory).mockReset();
    vi.mocked(db.listObjectDirectory).mockImplementation((path: string) => Promise.resolve(listings[path] ?? []));
    vi.mocked(db.openObjectPath).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.openInExplorer).mockReset().mockResolvedValue(undefined);
  });

  it("点击子文件夹进入，面包屑返回根目录", async () => {
    renderBody();
    fireEvent.click(await screen.findByText("会议纪要"));
    expect(await screen.findByText("周会.docx")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(nav).getByText("会议纪要")).toHaveAttribute("aria-current", "location");
    fireEvent.click(within(nav).getByRole("button", { name: "工作文档" }));
    expect(await screen.findByText("报告.docx")).toBeInTheDocument();
    expect(db.listObjectDirectory).toHaveBeenLastCalledWith("D:\\工作文档");
  });

  it("Enter 进入文件夹、Backspace 返回，按键不再冒泡给工作台", async () => {
    renderBody();
    await screen.findByText("会议纪要");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    list().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(await screen.findByText("周会.docx")).toBeInTheDocument();
    const back = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    list().dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(await screen.findByText("报告.docx")).toBeInTheDocument();
  });

  it("↓ 移动高亮，Enter 打开文件", async () => {
    renderBody();
    await screen.findByText("报告.docx");
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    list().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText("报告.docx").closest("li")).toHaveAttribute("data-active"));
    fireEvent.keyDown(list(), { key: "Enter" });
    expect(db.openObjectPath).toHaveBeenCalledWith("D:\\工作文档\\报告.docx");
  });

  it("行内按钮：文件打开、打开所在文件夹、加入库", async () => {
    const add = vi.fn(() => Promise.resolve());
    renderBody(add);
    const row = (await screen.findByText("报告.docx")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "打开" }));
    expect(db.openObjectPath).toHaveBeenCalledWith("D:\\工作文档\\报告.docx");
    fireEvent.click(within(row).getByRole("button", { name: "打开所在文件夹" }));
    expect(db.openInExplorer).toHaveBeenCalledWith("D:\\工作文档\\报告.docx");
    fireEvent.click(within(row).getByRole("button", { name: "加入库" }));
    expect(add).toHaveBeenCalledWith(["D:\\工作文档\\报告.docx"]);
    expect(db.listObjectDirectory).toHaveBeenCalledTimes(1);
  });

  it("达到上限时提示只显示前 5000 项", async () => {
    vi.mocked(db.listObjectDirectory).mockResolvedValue(
      Array.from({ length: 5000 }, (_, i) => file(`D:\\工作文档\\f${i}.txt`)),
    );
    renderBody();
    expect(await screen.findByText(/仅显示前 5000 项/)).toBeInTheDocument();
  });

  it("读取失败时显示原因", async () => {
    vi.mocked(db.listObjectDirectory).mockRejectedValue(new Error("拒绝访问"));
    renderBody();
    expect(await screen.findByText("拒绝访问")).toBeInTheDocument();
  });
});
