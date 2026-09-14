import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModManagerPanel } from "./ModManagerPanel";
import { useEscapeKey } from "../hooks/useEscapeKey";

const mocks = vi.hoisted(() => ({ enable: vi.fn(), parentClose: vi.fn() }));
vi.mock("../hooks/useMods", () => ({ useMods: () => ({
  mods: [{ id: "fixture", name: "测试扩展", type: "css+js", version: "1", author: "Test", description: "Test extension", enabled: false, permissions: ["dom"] }],
  enableMod: mocks.enable, disableMod: vi.fn(), uninstallMod: vi.fn(), refresh: vi.fn(),
}) }));

describe("扩展确认状态", () => {
  it("执行期间拦截 Esc 和重复确认，完成后恢复外层关闭行为", async () => {
    let finish!: () => void;
    mocks.enable.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    function Parent() {
      useEscapeKey(mocks.parentClose);
      return <ModManagerPanel />;
    }
    render(<Parent />);
    await userEvent.click(screen.getByRole("button", { name: "启用", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "我信任此扩展" }));
    expect(screen.getByRole("button", { name: "启用中…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(mocks.parentClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "启用脚本扩展" })).toBeInTheDocument();
    expect(mocks.enable).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.queryByRole("dialog", { name: "启用脚本扩展" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(mocks.parentClose).toHaveBeenCalledTimes(1);
  });
});
