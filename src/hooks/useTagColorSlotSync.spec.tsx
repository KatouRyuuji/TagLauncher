import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_FAMILIES } from "../themes";
import { useAppStore } from "../stores/appStore";

const FROST = THEME_FAMILIES[0].light;
const MONO = THEME_FAMILIES[3].light;
const EXISTING_SLOTS = JSON.stringify({
  tags: { "1": { slot: 5, hex: "#3b82f6" } },
  cabinets: {},
  lastOfficialThemeId: FROST,
});

const mocks = vi.hoisted(() => ({
  themeId: { current: "" },
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  recolorTagsAndCabinets: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
  recolorTagsAndCabinets: mocks.recolorTagsAndCabinets,
}));

vi.mock("../components/ThemeProvider", () => ({
  useThemeContext: () => ({ currentTheme: { id: mocks.themeId.current } }),
}));

vi.mock("../lib/toast", () => ({
  showToast: mocks.showToast,
}));

import { useTagColorSlotSync } from "./useTagColorSlotSync";

function seedTags() {
  useAppStore.getState().setTags([{ id: 1, name: "开发", color: "#3b82f6" }]);
}

describe("useTagColorSlotSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.themeId.current = FROST;
    mocks.getSetting.mockResolvedValue(null);
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.recolorTagsAndCabinets.mockResolvedValue(undefined);
    useAppStore.setState({ tags: [], cabinets: [] });
  });

  it("首次进入官方家族且 tags 已在 store → 调一次 recolorTagsAndCabinets", async () => {
    seedTags();
    renderHook(() => useTagColorSlotSync());
    await waitFor(() => {
      expect(mocks.recolorTagsAndCabinets).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setSetting).toHaveBeenCalledTimes(1);
    expect(mocks.setSetting.mock.calls[0]?.[0]).toBe("taglauncher.color_slots");
  });

  it("tags 为空时切主题 → 不调 IPC、不覆写设置", async () => {
    mocks.getSetting.mockResolvedValue(EXISTING_SLOTS);
    const { rerender } = renderHook(() => useTagColorSlotSync());
    await waitFor(() => expect(mocks.getSetting).toHaveBeenCalled());
    expect(mocks.recolorTagsAndCabinets).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();

    mocks.themeId.current = MONO;
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.recolorTagsAndCabinets).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it("IPC 拒绝 → 不 setSetting", async () => {
    seedTags();
    mocks.recolorTagsAndCabinets.mockRejectedValue(new Error("写回失败"));
    renderHook(() => useTagColorSlotSync());
    await waitFor(() => {
      expect(mocks.recolorTagsAndCabinets).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.setSetting).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it("tags 晚到 → 补跑一次", async () => {
    renderHook(() => useTagColorSlotSync());
    await waitFor(() => expect(mocks.getSetting).toHaveBeenCalled());
    expect(mocks.recolorTagsAndCabinets).not.toHaveBeenCalled();

    act(() => {
      seedTags();
    });
    await waitFor(() => {
      expect(mocks.recolorTagsAndCabinets).toHaveBeenCalledTimes(1);
    });
  });
});
