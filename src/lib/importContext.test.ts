import { assert, test, run } from "./__testutil";
import {
  intermediateDirs,
  LINKED_CABINET_IMPORT_NOTICE,
  planNestedImport,
  snapshotImportPlacement,
  toAddItemsContext,
} from "./importContext";

test("简单正选标签快照：普通柜入柜并赋直接标签", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [8, 9],
    excludedTagIds: [],
    searchQuery: "",
  });
  assert.deepEqual(placement, { cabinetId: 2, tagIds: [8, 9], linkedCabinetBlocked: false });
});

test("关键词搜索禁用自动打标，但不阻止普通柜归属", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [8],
    excludedTagIds: [],
    searchQuery: "readme",
  });
  assert.equal(placement.cabinetId, 2);
  assert.deepEqual(placement.tagIds, []);
  assert.equal(placement.linkedCabinetBlocked, false);
});

test("NOT / 反选禁用自动打标，柜归属仍在", () => {
  const notQuery = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [8],
    excludedTagIds: [],
    searchQuery: "alpha !!beta",
  });
  assert.equal(notQuery.cabinetId, 2);
  assert.deepEqual(notQuery.tagIds, []);

  const excluded = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [],
    excludedTagIds: [8],
    searchQuery: "",
  });
  assert.equal(excluded.cabinetId, 2);
  assert.deepEqual(excluded.tagIds, []);
});

test("关联目录柜不入柜，给出归属约束说明", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 5,
    cabinets: [{ id: 5, folder_path: "D:\\Photos" }],
    selectedTagIds: [1],
    excludedTagIds: [],
    searchQuery: "",
  });
  assert.equal(placement.cabinetId, null);
  assert.deepEqual(placement.tagIds, [1]);
  assert.equal(placement.linkedCabinetBlocked, true);
  assert.ok(LINKED_CABINET_IMPORT_NOTICE.includes("不会被移入"));
});

test("无柜无标签时上下文为空，不虚构归属", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: null,
    cabinets: [],
    selectedTagIds: [],
    excludedTagIds: [],
    searchQuery: "",
  });
  assert.deepEqual(placement, { cabinetId: null, tagIds: [], linkedCabinetBlocked: false });
  assert.deepEqual(toAddItemsContext(placement, []), {});
});

test("folder 模式只入库投放根，不隐藏", () => {
  const plan = planNestedImport({
    mode: "folder",
    droppedFolders: ["D:\\Work\\Docs"],
    droppedFiles: ["D:\\loose.txt"],
    expandedFiles: ["D:\\Work\\Docs\\a.txt"],
  });
  assert.deepEqual(plan.paths, ["D:\\Work\\Docs", "D:\\loose.txt"]);
  assert.deepEqual(plan.hideFromAllPaths, []);
});

test("contents / both：投放根可见，夹内文件与中间目录隐藏", () => {
  const expanded = ["D:\\Work\\Docs\\Sub\\a.txt", "D:\\Work\\Docs\\b.txt"];
  const contents = planNestedImport({
    mode: "contents",
    droppedFolders: ["D:\\Work\\Docs"],
    droppedFiles: ["C:\\temp\\x.exe"],
    expandedFiles: expanded,
  });
  assert.ok(contents.paths.includes("D:\\Work\\Docs"));
  assert.ok(contents.paths.includes("D:\\Work\\Docs\\Sub"));
  assert.ok(contents.paths.includes("D:\\Work\\Docs\\Sub\\a.txt"));
  assert.ok(contents.paths.includes("C:\\temp\\x.exe"));
  assert.ok(!contents.hideFromAllPaths.includes("D:\\Work\\Docs"));
  assert.ok(!contents.hideFromAllPaths.includes("C:\\temp\\x.exe"));
  assert.ok(contents.hideFromAllPaths.includes("D:\\Work\\Docs\\Sub"));
  assert.ok(contents.hideFromAllPaths.includes("D:\\Work\\Docs\\Sub\\a.txt"));
  assert.ok(contents.hideFromAllPaths.includes("D:\\Work\\Docs\\b.txt"));

  const both = planNestedImport({
    mode: "both",
    droppedFolders: ["D:\\Work\\Docs"],
    droppedFiles: [],
    expandedFiles: expanded,
  });
  assert.deepEqual(both.hideFromAllPaths.slice().sort(), contents.hideFromAllPaths.filter((p) => p !== "C:\\temp\\x.exe").slice().sort());
});

test("中间目录由文件路径推出，不把投放根之外的祖先收进来", () => {
  const dirs = intermediateDirs(["D:\\Work\\Docs"], ["D:\\Work\\Docs\\Sub\\Deep\\f.txt", "C:\\other\\z.txt"]);
  assert.deepEqual(dirs.slice().sort(), ["D:\\Work\\Docs", "D:\\Work\\Docs\\Sub", "D:\\Work\\Docs\\Sub\\Deep"].sort());
});

test("快照与隐藏路径一并交给后端，切换筛选不应改写已拍下的上下文", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 3,
    cabinets: [{ id: 3, folder_path: null }],
    selectedTagIds: [4],
    excludedTagIds: [],
    searchQuery: "",
  });
  const later = snapshotImportPlacement({
    selectedCabinetId: 9,
    cabinets: [{ id: 9, folder_path: null }],
    selectedTagIds: [99],
    excludedTagIds: [1],
    searchQuery: "later",
  });
  assert.notEqual(later.cabinetId, placement.cabinetId);
  const context = toAddItemsContext(placement, ["D:\\Work\\Docs\\a.txt"]);
  assert.deepEqual(context, { cabinetId: 3, tagIds: [4], hideFromAllPaths: ["D:\\Work\\Docs\\a.txt"] });
});

await run("importContext");
