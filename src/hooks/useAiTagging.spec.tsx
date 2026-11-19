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


  it("取消发生在串行队列回调与 await 边界时不再写标签", async () => {
    let releaseSuggest!: (names: string[]) => void;
    let releaseEnsure!: (id: number) => void;
    vi.mocked(db.aiSuggestTags).mockImplementation(
      () => new Promise((resolve) => { releaseSuggest = resolve; }),
    );
    vi.mocked(db.getItem).mockResolvedValue(item);
    const applyItemTags = vi.fn(async () => {});
    const ensureTag = vi.fn(
      () => new Promise<number>((resolve) => { releaseEnsure = resolve; }),
    );

    const { result } = renderHook(() => useAiTagging());
    let finished: Promise<{ tagged: number; failed: number; failures: unknown[] }>;
    act(() => {
      finished = result.current.start([item], {
        getVocabulary: () => [],
        ensureTag,
        applyItemTags,
      });
    });

    await waitFor(() => expect(db.aiSuggestTags).toHaveBeenCalled());
    await act(async () => {
      releaseSuggest(["风景"]);
    });
    await waitFor(() => expect(ensureTag).toHaveBeenCalled());

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      releaseEnsure(1);
      await finished;
    });

    expect(applyItemTags).not.toHaveBeenCalled();
    expect(db.getItem).not.toHaveBeenCalled();
    expect(result.current.state.canceled).toBe(true);
  });

  it("三项并发时取消后所有 worker 都不再写标签", async () => {
    const items: ItemWithTags[] = [1, 2, 3].map((id) => ({ ...item, id, name: `对象${id}.mp4` }));
    const releaseSuggest: Array<(names: string[]) => void> = [];
    let releaseEnsure!: (id: number) => void;
    vi.mocked(db.aiSuggestTags).mockImplementation(
      () => new Promise((resolve) => { releaseSuggest.push(resolve); }),
    );
    vi.mocked(db.getItem).mockImplementation(async (id: number) => items.find((it) => it.id === id) ?? item);
    const applyItemTags = vi.fn(async () => {});
    const ensureTag = vi.fn(
      () => new Promise<number>((resolve) => { releaseEnsure = resolve; }),
    );

    const { result } = renderHook(() => useAiTagging());
    let finished!: Promise<{ tagged: number; failed: number; failures: unknown[] }>;
    act(() => {
      finished = result.current.start(items, {
        getVocabulary: () => [],
        ensureTag,
        applyItemTags,
      });
    });

    await waitFor(() => expect(db.aiSuggestTags).toHaveBeenCalledTimes(3));
    await act(async () => {
      for (const release of releaseSuggest) release(["风景"]);
    });
    await waitFor(() => expect(ensureTag).toHaveBeenCalled());

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      releaseEnsure(1);
      await finished;
    });

    expect(applyItemTags).not.toHaveBeenCalled();
    expect(db.getItem).not.toHaveBeenCalled();
    expect(result.current.state.canceled).toBe(true);
  });
});
