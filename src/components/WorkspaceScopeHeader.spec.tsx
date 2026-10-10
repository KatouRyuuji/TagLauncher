// ============================================================================
// src/components/WorkspaceScopeHeader.spec.tsx — 关联文件夹的文件柜：范围栏
// ============================================================================
// 面包屑逐级返回、目录 / 平铺切换、「清理失效」与文件夹状态提示。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceScopeHeader } from "./WorkspaceScopeHeader";
import { useAppStore } from "../stores/appStore";
import type { Cabinet } from "../types";
import * as db from "../lib/db";

vi.mock("../lib/db", () => ({ listIgnoredPaths: vi.fn(async () => []), restoreIgnoredPaths: vi.fn(async () => {}) }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

function linked(overrides: Partial<Cabinet> = {}): Cabinet {
  return {
    id: 1,
    name: "照片",
    color: "#3b82f6",
    created_at: "2026-10-10T00:00:00Z",
    folder_path: "D:\\Photos",
    folder_truncated: false,
    folder_state: "ok",
    ...overrides,
  };
}

describe("WorkspaceScopeHeader · 关联文件夹的文件柜", () => {
  beforeEach(() => {
    useAppStore.setState({
      cabinets: [linked()],
      selectedCabinetId: 1,
      cabinetDir: "D:\\Photos\\2024\\Trip",
      cabinetFlat: false,
      selectedTagIds: [],
      excludedTagIds: [],
      showFavorites: false,
      showRecent: false,
      searchQuery: "",
    });
  });

  it("面包屑从柜名起逐级列出，点击返回对应目录", async () => {
    render(<WorkspaceScopeHeader visibleCount={3} browseDir="D:\Photos\2024\Trip" />);
    const nav = screen.getByRole("navigation", { name: "文件夹路径" });
    expect(nav).toHaveTextContent("照片2024Trip");
    await userEvent.click(screen.getByRole("button", { name: "2024" }));
    expect(useAppStore.getState().cabinetDir).toBe("D:\\Photos\\2024");
    await userEvent.click(screen.getByRole("button", { name: "照片" }));
    expect(useAppStore.getState().cabinetDir).toBeNull();
  });

  it("平铺开关切换显示方式", async () => {
    render(<WorkspaceScopeHeader visibleCount={3} browseDir="D:\Photos" />);
    await userEvent.click(screen.getByRole("button", { name: "平铺显示" }));
    expect(useAppStore.getState().cabinetFlat).toBe(true);
  });

  it("有失效对象时提供「清理失效」，交出全部失效 id", async () => {
    const onCleanMissing = vi.fn();
    render(<WorkspaceScopeHeader visibleCount={3} browseDir="D:\Photos" missingIds={[4, 9]} onCleanMissing={onCleanMissing} />);
    await userEvent.click(screen.getByRole("button", { name: /清理失效（2）/ }));
    expect(onCleanMissing).toHaveBeenCalledWith([4, 9]);
  });

  it("磁盘未接入时提示同步暂停", () => {
    useAppStore.setState({ cabinets: [linked({ folder_state: "offline" })] });
    render(<WorkspaceScopeHeader visibleCount={0} browseDir="D:\Photos" />);
    expect(screen.getByRole("status")).toHaveTextContent("所在磁盘未接入，同步已暂停");
  });

  it("普通文件柜不显示关联栏", () => {
    useAppStore.setState({ cabinets: [linked({ folder_path: null, folder_state: null })] });
    render(<WorkspaceScopeHeader visibleCount={0} />);
    expect(screen.queryByRole("navigation", { name: "文件夹路径" })).toBeNull();
  });

  it("有忽略项时显示「已忽略 N 项」，勾选后恢复追踪", async () => {
    vi.mocked(db.listIgnoredPaths).mockResolvedValue(["D:\\Photos\\a.jpg", "D:\\Photos\\Sub"]);
    render(<WorkspaceScopeHeader visibleCount={3} browseDir="D:\Photos" />);
    await userEvent.click(await screen.findByRole("button", { name: /已忽略 2 项/ }));
    expect(db.listIgnoredPaths).toHaveBeenCalledWith("D:\\Photos");
    const dialog = screen.getByRole("dialog", { name: "已忽略的对象" });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Sub/ }));
    await userEvent.click(screen.getByRole("button", { name: "恢复追踪（1）" }));
    await waitFor(() => expect(db.restoreIgnoredPaths).toHaveBeenCalledWith(["D:\\Photos\\Sub"]));
  });
});
