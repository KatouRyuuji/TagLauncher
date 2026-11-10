// ============================================================================
// scripts/view-corpus/gen-view-corpus.ts — 用现有 TS 视图管线生成 Rust 视图查询的对照语料
// ----------------------------------------------------------------------------
// 一次性生成、提交为 fixture：Rust 端 view 模块逐条比对（同一输入 → 同一顺序的 id）。
// 管线与迁移前 useItems 的非搜索分支一致：视图域 → 标签筛选 → 目录层 / All 隐藏夹内 →
// 隐藏失效 → 类型筛选 → 排序（smart 用冻结键）。另记录搜索时交给后端的范围 searchScope。
// 用法：node_modules/.bin/esbuild scripts/view-corpus/gen-view-corpus.ts --bundle --platform=node
//        --format=esm --outfile=/tmp/gen-view.mjs && node /tmp/gen-view.mjs
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { applyMissingFilter, applyWorkspaceQuery, isSortMode } from "../../src/lib/itemQuery";
import type { SortMode, TypeFilter } from "../../src/lib/itemQuery";
import { expandForTagFilter, filterItemsByTags } from "../../src/lib/tagFilter";
import { buildDescendantsMap } from "../../src/lib/tagGraph";
import { currentBrowseDir, itemsInDir } from "../../src/lib/cabinetBrowse";
import { applyNestedVisibility, libraryBrowseDirOf, shouldRevealNested } from "../../src/lib/nestedVisibility";
import type { ItemWithTags } from "../../src/types";

let seed = 20261110;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const searchCorpus = JSON.parse(readFileSync("src-tauri/tests/fixtures/search_corpus.json", "utf8"));
const baseNames: string[] = searchCorpus.items.map((it: { name: string }) => it.name);
const extraNames = ["file2.txt", "file10.txt", "File1.txt", "重庆", "重要", "长城", "IMG_0012.png", "IMG_12.png", "（2）报告", "(1) report", "Ⅱ期", "１２", "12", "é", "e", "ß", "ss", "🎮 game", "カタカナ", "한국"];
const TYPES = ["folder", "image", "audio", "video", "text", "exe", "bat", "ps1"] as const;
const ROOTS = ["D:\\Lib", "D:\\Lib\\A", "D:\\Lib\\A\\Sub", "D:\\Lib\\B", "d:\\lib\\b\\深层", "E:\\Other", "D:/Lib/A/Fwd"];
const STAMPS = ["2026-01-01 10:00:00", "2026-03-05 08:30:00", "2026-03-05 08:30:00", "2026-11-10 21:00:00", "2025-12-31 23:59:59"];

const N_TAGS = 12;
const items: ItemWithTags[] = [];
for (let i = 0; i < 420; i++) {
  const name = i < baseNames.length ? baseNames[i] : pick([...baseNames, ...extraNames]) + (chance(0.5) ? ` ${Math.floor(rnd() * 30)}` : "");
  const dir = pick(ROOTS);
  const type = pick(TYPES);
  const tagIds = [...new Set(Array.from({ length: Math.floor(rnd() * 4) }, () => 1 + Math.floor(rnd() * N_TAGS)))];
  items.push({
    id: i + 1,
    name,
    path: chance(0.03) ? `${dir}\\` : `${dir}${dir.includes("/") ? "/" : "\\"}${name}`,
    type,
    created_at: pick(STAMPS),
    last_used_at: chance(0.5) ? pick(STAMPS) : undefined,
    is_favorite: chance(0.15),
    is_missing: chance(0.1),
    fs_created_at: chance(0.8) ? 1_700_000_000 + Math.floor(rnd() * 5) * 1000 : null,
    fs_modified_at: chance(0.8) ? 1_700_000_000 + Math.floor(rnd() * 5) * 1000 : null,
    hide_from_all: chance(0.3),
    alias: chance(0.1) ? pick(["  ", "别名", "Alias 2", " 项目 "]) : null,
    tags: tagIds.map((id) => ({ id, name: `t${id}`, color: "#fff" })) as ItemWithTags["tags"],
  });
}
// 源顺序 = 后端索引顺序（ITEM_ORDER：收藏 → 最近使用 DESC NULLS LAST → 名称二进制序）
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
items.sort((a, b) =>
  Number(b.is_favorite) - Number(a.is_favorite) ||
  (a.last_used_at && b.last_used_at ? binary(b.last_used_at, a.last_used_at) : a.last_used_at ? -1 : b.last_used_at ? 1 : 0) ||
  binary(a.name, b.name));

const relations = [
  { parentId: 1, childId: 2 }, { parentId: 2, childId: 3 }, { parentId: 1, childId: 4 },
  { parentId: 5, childId: 4 }, { parentId: 6, childId: 7 }, { parentId: 7, childId: 8 },
];
const descendantsMap = buildDescendantsMap(relations as never);
const manualCabinet = items.filter(() => chance(0.2)).map((it) => it.id);
const linkedFolder = "D:\\Lib\\A";
const linkedMembers = items.filter((it) => it.path.replace(/\//g, "\\").toLowerCase().startsWith("d:\\lib\\a\\")).map((it) => it.id);
const SORTS = ["smart", "name", "name-desc", "recent", "added", "added-desc", "fs-created", "fs-created-asc", "fs-modified", "fs-modified-asc", "type"] as const;
const TYPE_FILTERS = ["all", "all", "folder", "image", "audio", "video", "text", "exe", "script"] as const;
const DIRS = [null, "D:\\Lib", "D:\\Lib\\A", "d:\\lib\\a\\sub", "D:\\Lib\\A\\Sub\\", "D:\\Lib\\B", "E:\\Nope"];

const frozenSets = Array.from({ length: 4 }, () =>
  Object.fromEntries(items.filter(() => chance(0.4)).map((it) => [it.id, chance(0.3) ? null : pick(STAMPS)])));
const cases = [];
for (let c = 0; c < 2000; c++) {
  const scope = pick(["all", "all", "all", "favorites", "recent", "cabinet", "linked"] as const);
  const selectedTagIds = chance(0.4) ? [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => 1 + Math.floor(rnd() * N_TAGS)))] : [];
  const excludedTagIds = chance(0.2) ? [1 + Math.floor(rnd() * N_TAGS)] : [];
  const tagFilterMode = chance(0.7) ? "descendants" : "direct";
  const typeFilter: TypeFilter = pick(TYPE_FILTERS);
  const hideMissing = chance(0.3);
  const sortMode: SortMode = pick(SORTS);
  if (!isSortMode(sortMode)) throw new Error(sortMode);
  const showNestedContents = chance(0.3);
  const libraryBrowseRoot = scope === "all" && chance(0.3) ? pick(DIRS.filter(Boolean)) : null;
  const libraryBrowseDir = libraryBrowseRoot && chance(0.5) ? pick(DIRS) : null;
  const cabinetDir = scope === "linked" && chance(0.6) ? pick(DIRS) : null;
  const cabinetFlat = scope === "linked" && chance(0.3);
  const frozenIndex = chance(0.5) ? Math.floor(rnd() * frozenSets.length) : null;
  const frozen = frozenIndex === null ? null : frozenSets[frozenIndex];

  const cabinetMemberIds = scope === "cabinet" ? manualCabinet : scope === "linked" ? linkedMembers : null;
  // 柜内容：后端 get_cabinet_items 同样按 ITEM_ORDER，与索引顺序一致
  const source = scope === "favorites" ? items.filter((it) => it.is_favorite)
    : scope === "recent" ? items.filter((it) => Boolean(it.last_used_at))
    : cabinetMemberIds ? items.filter((it) => cabinetMemberIds.includes(it.id))
    : items;
  const tagFiltered = filterItemsByTags(source, selectedTagIds, expandForTagFilter(tagFilterMode !== "direct", descendantsMap), excludedTagIds);
  const browseDir = scope === "linked" && !cabinetFlat && selectedTagIds.length === 0 && excludedTagIds.length === 0
    ? currentBrowseDir(linkedFolder, cabinetDir) : null;
  const libraryDir = libraryBrowseDirOf(libraryBrowseRoot, libraryBrowseDir, { hasSearchQuery: false, selectedTagIds, excludedTagIds });
  const revealNested = shouldRevealNested({
    showNestedContents, hasSearchQuery: false, selectedTagIds, excludedTagIds,
    selectedCabinetId: cabinetMemberIds ? 1 : null, showFavorites: scope === "favorites", showRecent: scope === "recent", libraryBrowseRoot,
  });
  const layerDir = browseDir ?? libraryDir;
  const scoped = layerDir !== null ? itemsInDir(tagFiltered, layerDir) : applyNestedVisibility(tagFiltered, revealNested);
  const overrides = frozen ? new Map(Object.entries(frozen).map(([k, v]) => [Number(k), v ?? undefined] as const)) : undefined;
  const ids = applyWorkspaceQuery(applyMissingFilter(scoped, hideMissing), {
    typeFilter, sortMode,
    sortKeyOverrides: scope === "recent" || sortMode === "recent" ? undefined : { lastUsedAt: overrides },
  }).map((it) => it.id);
  cases.push({
    params: { scope, selectedTagIds, excludedTagIds, tagFilterMode, typeFilter, hideMissing, sortMode, showNestedContents, libraryBrowseRoot, libraryBrowseDir, cabinetDir, cabinetFlat },
    cabinet: scope === "cabinet" || scope === "linked" ? scope : null, frozen: frozenIndex,
    expected: { ids, browseDir, searchScope: tagFiltered !== items ? tagFiltered.map((it) => it.id) : null },
  });
}
// 冻结键里 null 与 undefined：TS 里 `?? ""` 使二者同为最早，语料统一写 null
writeFileSync("src-tauri/tests/fixtures/view_corpus.json", JSON.stringify({
  items: items.map(({ tags, ...it }) => ({ ...it, last_used_at: it.last_used_at ?? null, tagIds: tags.map((t) => t.id) })),
  descendants: Object.fromEntries([...descendantsMap].map(([k, v]) => [k, [...v]])),
  linkedFolder,
  cabinets: { cabinet: manualCabinet, linked: linkedMembers },
  frozenSets,
  cases,
}));
console.log("items", items.length, "cases", cases.length);
