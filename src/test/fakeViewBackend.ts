// ============================================================================
// test/fakeViewBackend.ts — useItems 规格测试用的后端替身
// ----------------------------------------------------------------------------
// view_query / library_stats / get_items_by_ids 走演示后端同一套 TS 视图管线
// （与 Rust 实现的一致性由 src-tauri/src/view/corpus_tests.rs 逐例对照），
// 搜索用名称子串 + 两个拼音缩写示例（打分语义由 Rust 测试覆盖）。
// 测试经 fake.items 换库、经 fake.cabinets 设柜成员。
// ============================================================================
import { vi } from "vitest";
import { demoLibraryStats, demoView } from "../demo/demoView";
import type { ViewQueryArgs } from "../lib/db";
import type { SortMode, TypeFilter } from "../lib/itemQuery";
import type { ItemWithTags } from "../types";

const PINYIN: Record<string, string> = { xmwd: "项目文档", vsc: "Visual Studio Code" };

export interface FakeBackend {
  items: ItemWithTags[];
  cabinets: Map<number, { members: number[]; folder: string | null }>;
}

export function search(fake: FakeBackend, query: string, scope: number[] | null, typeFilter: string, hideMissing: boolean): number[] {
  const q = query.trim().toLowerCase();
  const byId = new Map(fake.items.map((it) => [it.id, it]));
  const base = scope ? scope.map((id) => byId.get(id)).filter((it): it is ItemWithTags => !!it) : fake.items;
  return base
    .filter((it) => (typeFilter && typeFilter !== "all" ? it.type === typeFilter : true))
    .filter((it) => !(hideMissing && it.is_missing))
    .filter((it) => it.name.toLowerCase().includes(q) || PINYIN[q] === it.name)
    .map((it) => it.id);
}

export function fakeView(fake: FakeBackend, args: ViewQueryArgs) {
  const cabinet = args.scope === "cabinet" ? fake.cabinets.get(args.cabinetId ?? -1) ?? { members: [], folder: null } : null;
  return demoView(fake.items, {
    scope: args.scope,
    members: cabinet ? new Set(cabinet.members) : null,
    linkedFolder: cabinet?.folder ?? null,
    selectedGroups: args.selectedGroups,
    excludedGroups: args.excludedGroups,
    typeFilter: args.typeFilter as TypeFilter,
    hideMissing: args.hideMissing,
    sortMode: args.sortMode as SortMode,
    showNestedContents: args.showNestedContents,
    libraryBrowseRoot: args.libraryBrowseRoot,
    libraryBrowseDir: args.libraryBrowseDir,
    cabinetDir: args.cabinetDir,
    cabinetFlat: args.cabinetFlat,
    query: args.query,
    search: (scope) => search(fake, args.query, scope, args.typeFilter, args.hideMissing),
  });
}

/** db 模块替身中与视图相关的部分 */
export function fakeViewDb(fake: FakeBackend) {
  return {
    viewQuery: vi.fn(async (args: ViewQueryArgs) => fakeView(fake, args)),
    libraryStats: vi.fn(async (groups: [number, number[]][]) => demoLibraryStats(fake.items, groups)),
    getItemsByIds: vi.fn(async (ids: number[]) => {
      const byId = new Map(fake.items.map((it) => [it.id, it]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    }),
    getItemsPage: vi.fn(async (ids: number[]) => {
      const byId = new Map(fake.items.map((it) => [it.id, it]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    }),
    getItems: vi.fn(async () => fake.items),
    viewTypeahead: vi.fn(async () => null),
  };
}
