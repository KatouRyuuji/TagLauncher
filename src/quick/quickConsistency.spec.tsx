// 快速窗与主窗搜索结果一致：同一批对象、同一查询，主窗 useItems（无筛选、全部类型）
// 与快速窗 quickResults 给出同一组、同一顺序的对象。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "../hooks/useItems";
import { useAppStore } from "../stores/appStore";
import { ensurePinyin } from "../lib/pinyinProvider";
import type { ItemWithTags } from "../types";
import { buildQuickData, quickResults } from "./quickModel";

const tag = (id: number, name: string) => ({ id, name, color: "#5064d8" });
const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [tag(1, "工作")] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-02", is_favorite: true, tags: [tag(2, "开发")] },
  { id: 3, name: "设计稿.psd", path: "D:/设计稿.psd", type: "image", created_at: "2026-01-03", is_favorite: false, tags: [tag(1, "工作")], last_used_at: "2026-11-01 08:00:00" },
  { id: 4, name: "旧工具.exe", path: "D:/旧工具.exe", type: "exe", created_at: "2026-01-04", is_favorite: false, tags: [], is_missing: true },
  { id: 5, name: "code-notes.md", path: "D:/code-notes.md", type: "text", created_at: "2026-01-05", is_favorite: false, tags: [tag(2, "开发")], alias: "代码笔记" },
  { id: 6, name: "游戏启动器", path: "D:/game.exe", type: "exe", created_at: "2026-01-06", is_favorite: true, tags: [tag(3, "娱乐")] },
];

vi.mock("../lib/db", () => ({
  getItems: vi.fn(async () => fixtures),
  getCabinetItems: vi.fn(async () => []),
  relocateMissing: vi.fn(),
}));
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn() }));

const QUERIES = ["code", "xmwd", "工作", "#开发", "工作 || 娱乐", "dmbj", "vsc", "e", "@", "不存在的词"];

describe("快速窗与主窗同一查询代码", () => {
  beforeAll(async () => { await ensurePinyin(); });
  beforeEach(() => {
    useAppStore.setState({ searchQuery: "", searchMode: "all", selectedTagIds: [], excludedTagIds: [], selectedCabinetId: null, showFavorites: false, showRecent: false, typeFilter: "all", hideMissing: false, showNestedContents: false, libraryBrowseRoot: null, libraryBrowseDir: null, sortMode: "smart", tagRelations: [], tagFilterMode: "descendants" });
  });

  for (const hideMissing of [false, true]) {
    it(`hideMissing=${hideMissing}：每个查询结果一致`, async () => {
      act(() => useAppStore.setState({ hideMissing }));
      const { result } = renderHook(useItems);
      await waitFor(() => expect(result.current.loading).toBe(false));
      const quick = buildQuickData(fixtures, "all");
      let nonEmpty = 0;
      for (const q of QUERIES) {
        act(() => useAppStore.setState({ searchQuery: q }));
        const expected = quickResults(quick, q, { hideMissing }).map((i) => i.id);
        if (expected.length > 0) nonEmpty += 1;
        await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(expected));
      }
      // 防空测：多数查询应有结果，比较才有意义
      expect(nonEmpty).toBeGreaterThanOrEqual(6);
    });
  }
});
