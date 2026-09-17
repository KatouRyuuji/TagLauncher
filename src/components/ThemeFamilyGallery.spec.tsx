import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeFamilyGallery } from "./ThemeFamilyGallery";
import { THEME_FAMILIES, presetThemes, resolveFamilyThemeId } from "../themes";

describe("官方配色 Gallery", () => {
  it("2×2 四族 radio，aria-label 为家族名", () => {
    render(
      <ThemeFamilyGallery
        themes={presetThemes}
        currentThemeId={THEME_FAMILIES[0].light}
        effectiveMode="light"
        onSelect={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "官方配色" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "霜靛" })).toHaveAttribute("aria-checked", "true");
    for (const family of THEME_FAMILIES.slice(1)) {
      expect(screen.getByRole("radio", { name: family.name })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("点选套用该族在当前模式下的主题 id", async () => {
    const onSelect = vi.fn();
    render(
      <ThemeFamilyGallery
        themes={presetThemes}
        currentThemeId={THEME_FAMILIES[0].light}
        effectiveMode="dark"
        onSelect={onSelect}
      />,
    );
    const fuji = THEME_FAMILIES.find((family) => family.name === "藤色")!;
    await userEvent.click(screen.getByRole("radio", { name: "藤色" }));
    expect(onSelect).toHaveBeenCalledWith(resolveFamilyThemeId(fuji, "dark"));
  });

  it("当前主题不是官方家族时四卡都不勾", () => {
    render(
      <ThemeFamilyGallery
        themes={presetThemes}
        currentThemeId="custom-not-a-family"
        effectiveMode="light"
        onSelect={vi.fn()}
      />,
    );
    for (const family of THEME_FAMILIES) {
      expect(screen.getByRole("radio", { name: family.name })).toHaveAttribute("aria-checked", "false");
    }
  });
});
