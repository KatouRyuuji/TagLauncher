// ============================================================================
// demo/demoView.ts — 演示后端的主窗视图查询（view_query / library_stats 的浏览器内替身）
// ----------------------------------------------------------------------------
// 真实实现在 Rust（src-tauri/src/view，与迁移前的 TS 管线逐条对照）。演示环境数据量小，
// 这里用同一组前端辅助函数直接算；smart 排序不做会话冻结（演示无需反瞬移）。
// ============================================================================
import { applyMissingFilter, applyWorkspaceQuery } from "../lib/itemQuery";
import type { SortMode, TypeFilter } from "../lib/itemQuery";
import { currentBrowseDir, itemsInDir } from "../lib/cabinetBrowse";
import type { ItemWithTags } from "../types";

export interface DemoViewArgs {
  scope: string;
  members: Set<number> | null;
  linkedFolder: string | null;
  selectedGroups: number[][];
  excludedGroups: number[][];
  typeFilter: TypeFilter;
  hideMissing: boolean;
  sortMode: SortMode;
  showNestedContents: boolean;
  libraryBrowseRoot: string | null;
  libraryBrowseDir: string | null;
  cabinetDir: string | null;
  cabinetFlat: boolean;
  query: string;
  search: (scope: number[] | null) => number[];
}

export function demoView(items: ItemWithTags[], a: DemoViewArgs): { ids: number[]; browseDir: string | null; libraryTotal: number } {
  const source = a.scope === "favorites" ? items.filter((it) => it.is_favorite)
    : a.scope === "recent" ? items.filter((it) => Boolean(it.last_used_at))
    : a.members ? items.filter((it) => a.members!.has(it.id))
    : items;
  const hasTags = a.selectedGroups.length > 0 || a.excludedGroups.length > 0;
  const hit = (it: ItemWithTags, g: number[]) => it.tags.some((t) => g.includes(t.id));
  const tagged = hasTags
    ? source.filter((it) => a.selectedGroups.every((g) => hit(it, g)) && !a.excludedGroups.some((g) => hit(it, g)))
    : source;
  if (a.query.trim()) {
    const scoped = a.scope !== "all" || hasTags;
    return { ids: a.search(scoped ? tagged.map((it) => it.id) : null), browseDir: null, libraryTotal: items.length };
  }
  const browseDir = a.linkedFolder && !a.cabinetFlat && !hasTags ? currentBrowseDir(a.linkedFolder, a.cabinetDir) : null;
  const libraryDir = a.libraryBrowseRoot && !hasTags ? currentBrowseDir(a.libraryBrowseRoot, a.libraryBrowseDir) : null;
  const reveal = a.showNestedContents || hasTags || a.scope !== "all" || a.libraryBrowseRoot !== null;
  const layer = browseDir ?? libraryDir;
  const scoped = layer !== null ? itemsInDir(tagged, layer) : reveal ? tagged : tagged.filter((it) => !it.hide_from_all);
  const ids = applyWorkspaceQuery(applyMissingFilter(scoped, a.hideMissing), { typeFilter: a.typeFilter, sortMode: a.sortMode }).map((it) => it.id);
  return { ids, browseDir, libraryTotal: items.length };
}

export function demoLibraryStats(items: ItemWithTags[], tagGroups: [number, number[]][]) {
  const tagCounts: [number, number][] = tagGroups.map(([tag, group]) => [
    tag,
    items.filter((it) => it.tags.some((t) => group.includes(t.id))).length,
  ]);
  return {
    total: items.length,
    favorites: items.filter((it) => it.is_favorite).length,
    recent: items.filter((it) => Boolean(it.last_used_at)).length,
    untagged: items.filter((it) => it.tags.length === 0).length,
    missingIds: items.filter((it) => it.is_missing).map((it) => it.id),
    tagCounts,
  };
}
