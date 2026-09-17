import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiTagging } from "./useAiTagging";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("../lib/db", () => ({
  aiSuggestTags: vi.fn(),
  getItem: vi.fn(),
}));

const item: ItemWithTags = {
  id: 1,
  name: "日落.mp4",
  path: "D:/sunset.mp4",
  type: "video",
  created_at: "2026-01-01",
  is_favorite: false,
  tags: [],
};

describe("useAiTagging currentName", () => {
  beforeEach(() => {
    vi.mocked(db.aiSuggestTags).mockReset();
    vi.mocked(db.getItem).mockReset();
  });

  it("处理中 currentName 是对象名", async () => {
    let release!: (names: string[]) => void;
    vi.mocked(db.aiSuggestTags).mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    vi.mocked(db.getItem).mockResolvedValue(item);

    const { result } = renderHook(() => useAiTagging());
    let finished: Promise<unknown>;
    act(() => {
      finished = result.current.start([item], {
        getVocabulary: () => [],
        ensureTag: async () => 1,
        applyItemTags: async () => {},
      });
    });

    await waitFor(() => {
      expect(result.current.state.currentName).toBe("日落.mp4");
    });
    expect(result.current.state.lastNames).toEqual([]);

    await act(async () => {
      release(["风景"]);
      await finished;
    });

    expect(result.current.state.currentName).toBeNull();
    expect(result.current.state.lastNames).toEqual(["风景"]);
  });
});
