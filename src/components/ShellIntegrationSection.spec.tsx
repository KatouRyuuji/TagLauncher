import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({
  state: null as unknown as Record<string, unknown>,
  failNext: null as string | null,
  pref: null as unknown,
}));

const base = (over: Record<string, unknown> = {}) => ({
  supported: true, enabled: false, partial: false, registeredExe: null, currentExe: "C:\\App\\TagLauncher.exe",
  exeMatches: true, sendTo: false, verbs: [], ...over,
});

vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("../lib/db", () => ({
  getShellIntegration: vi.fn(async () => structuredClone(shell.state)),
  setShellIntegration: vi.fn(async (enabled: boolean) => {
    if (shell.failNext) {
      const message = shell.failNext;
      shell.failNext = null;
      throw new Error(message);
    }
    shell.state = base(enabled ? { enabled: true, sendTo: true, registeredExe: "C:\\App\\TagLauncher.exe" } : {});
    return structuredClone(shell.state);
  }),
  getCollectPreference: vi.fn(async () => shell.pref),
  setCollectPreference: vi.fn(async (p: unknown) => { shell.pref = p; return p; }),
  getTags: vi.fn(async () => [{ id: 1, name: "设计", color: "#000" }]),
  getCabinets: vi.fn(async () => []),
}));

import * as db from "../lib/db";
import { ShellIntegrationSection } from "./ShellIntegrationSection";

beforeEach(() => {
  vi.clearAllMocks();
  shell.state = base();
  shell.failNext = null;
  shell.pref = null;
});

describe("右键菜单设置", () => {
  it("默认关闭；开启/关闭都以后端实际状态为准，失败时显示原因", async () => {
    const user = userEvent.setup();
    render(<ShellIntegrationSection disabled={false} />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    // 多选上限说明（经典动词 Player 模型最多 100 项）
    expect(screen.getByTestId("shell-integration-limit")).toHaveTextContent("一次最多选 100 项");
    shell.failNext = "拒绝访问";
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("拒绝访问");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(db.setShellIntegration).toHaveBeenLastCalledWith(true);
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(db.setShellIntegration).toHaveBeenLastCalledWith(false);
  });

  it("部分注册或程序挪了位置时给出修复入口；记住的选择可改为每次询问", async () => {
    const user = userEvent.setup();
    shell.state = base({ partial: true, registeredExe: "D:\\Old\\TagLauncher.exe", exeMatches: false });
    shell.pref = { action: "tag", tagIds: [1], cabinetId: null, folderMode: null };
    render(<ShellIntegrationSection disabled={false} />);
    expect(await screen.findByTestId("shell-integration-partial")).toBeInTheDocument();
    expect(screen.getByTestId("shell-integration-moved")).toHaveTextContent("D:\\Old\\TagLauncher.exe");
    expect(await screen.findByTestId("collect-preference")).toHaveTextContent("打标签「设计」");
    await user.click(screen.getByRole("button", { name: "改为每次询问" }));
    await waitFor(() => expect(db.setCollectPreference).toHaveBeenCalledWith(null));
    await waitFor(() => expect(screen.queryByTestId("collect-preference")).toBeNull());
    await user.click(screen.getByRole("button", { name: "修复为当前位置" }));
    await waitFor(() => expect(screen.queryByTestId("shell-integration-moved")).toBeNull());
    expect(db.setShellIntegration).toHaveBeenCalledWith(true);
  });

  it("非 Windows 不渲染", async () => {
    shell.state = base({ supported: false });
    const { container } = render(<ShellIntegrationSection disabled={false} />);
    await waitFor(() => expect(db.getShellIntegration).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-testid=shell-integration]")).toBeNull());
  });
});
