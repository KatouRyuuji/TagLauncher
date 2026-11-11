import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFolderImport } from "./useFolderImport";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";

vi.mock("../lib/db", () => ({
  classifyImportPaths: vi.fn(),
  expandFolderImport: vi.fn(),
}));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

const regularCabinet = { id: 2, name: "收件", color: "#fff", created_at: "2026-01-01", folder_path: null, folder_truncated: false };
const laterCabinet = { id: 9, name: "稍后", color: "#000", created_at: "2026-01-01", folder_path: null, folder_truncated: false };
const linkedCabinet = { id: 5, name: "照片", color: "#fff", created_at: "2026-01-01", folder_path: "D:\\Photos", folder_truncated: false };

describe("useFolderImport 导入上下文快照", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      cabinets: [regularCabinet, laterCabinet, linkedCabinet],
      selectedCabinetId: 2,
      selectedTagIds: [8],
      excludedTagIds: [],
      searchQuery: "",
    });
  });

  it("发起后切柜/改标签，确认时仍用当时快照", async () => {
    let finishClassify!: (value: { files: string[]; folders: string[] }) => void;
    vi.mocked(db.classifyImportPaths).mockImplementationOnce(
      () => new Promise((resolve) => { finishClassify = resolve; }),
    );
    vi.mocked(db.expandFolderImport).mockResolvedValue({ paths: ["D:\\Work\\Docs\\a.txt"], truncated: false });
    const addItems = vi.fn(async () => {});
    const { result } = renderHook(() => useFolderImport(addItems));

    let pending!: Promise<void>;
    act(() => { pending = result.current.requestAddPaths(["D:\\Work\\Docs"]); });
    act(() => {
      useAppStore.setState({ selectedCabinetId: 9, selectedTagIds: [99], searchQuery: "later" });
    });
    await act(async () => finishClassify({ files: [], folders: ["D:\\Work\\Docs"] }));
    await pending;
    await waitFor(() => expect(result.current.folderImportDialog.open).toBe(true));

    await act(async () => {
      await result.current.folderImportDialog.onConfirm("contents", false);
    });
    expect(addItems).toHaveBeenCalledTimes(1);
    const [, context] = addItems.mock.calls[0];
    expect(context).toMatchObject({ cabinetId: 2, tagIds: [8] });
    expect(context?.hideFromAllPaths).toContain("D:\\Work\\Docs\\a.txt");
    expect(context?.hideFromAllPaths).not.toContain("D:\\Work\\Docs");
  });

  it("异步展开期间再切柜，也不会写到后来的上下文", async () => {
    vi.mocked(db.classifyImportPaths).mockResolvedValue({ files: [], folders: ["D:\\Work\\Docs"] });
    let finishExpand!: (value: { paths: string[]; truncated: boolean }) => void;
    vi.mocked(db.expandFolderImport).mockImplementationOnce(
      () => new Promise((resolve) => { finishExpand = resolve; }),
    );
    const addItems = vi.fn(async () => {});
    const { result } = renderHook(() => useFolderImport(addItems));
    await act(async () => { await result.current.requestAddPaths(["D:\\Work\\Docs"]); });

    let confirm!: Promise<void>;
    act(() => { confirm = result.current.folderImportDialog.onConfirm("both", false); });
    act(() => { useAppStore.setState({ selectedCabinetId: 9, selectedTagIds: [1] }); });
    await act(async () => finishExpand({ paths: ["D:\\Work\\Docs\\a.txt"], truncated: false }));
    await confirm;
    expect(addItems.mock.calls[0][1]).toMatchObject({ cabinetId: 2, tagIds: [8] });
  });

  it("关联目录柜不传入 cabinetId，并提示不会移动磁盘文件", async () => {
    useAppStore.setState({ selectedCabinetId: 5, selectedTagIds: [] });
    vi.mocked(db.classifyImportPaths).mockResolvedValue({ files: ["D:\\x.exe"], folders: [] });
    const addItems = vi.fn(async () => {});
    const { result } = renderHook(() => useFolderImport(addItems));
    await act(async () => { await result.current.requestAddPaths(["D:\\x.exe"]); });
    expect(addItems).toHaveBeenCalledWith(["D:\\x.exe"], {});
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("不会被移入"), "info");
  });
});
