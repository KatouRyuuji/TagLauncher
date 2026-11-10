import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { UiFontScaleSelect } from "./UiFontScaleSelect";
import { useAppStore } from "../stores/appStore";

describe("界面字号设置", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().setUiFontScale(1);
  });

  it("选「大」写入根变量并持久化，回「标准」清除", async () => {
    render(<UiFontScaleSelect />);
    await userEvent.click(screen.getByRole("radio", { name: "大" }));
    expect(screen.getByRole("radio", { name: "大" })).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale")).toBe("1.1");
    expect(JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}").uiFontScale).toBe(1.1);
    await userEvent.click(screen.getByRole("radio", { name: "标准" }));
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale")).toBe("");
  });

  it("不改卡片缩放与列表密度", async () => {
    const before = useAppStore.getState();
    render(<UiFontScaleSelect />);
    await userEvent.click(screen.getByRole("radio", { name: "特大" }));
    const after = useAppStore.getState();
    expect(after.cardSizeScale).toBe(before.cardSizeScale);
    expect(after.listDensity).toBe(before.listDensity);
  });
});
