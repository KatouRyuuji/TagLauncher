import { assert, test, run } from "./__testutil";
import {
  intermediateDirs,
  LINKED_CABINET_IMPORT_NOTICE,
  planNestedImport,
  importPlacementBanner,
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

test("contents 空文件夹不入库根；both 仍加入文件夹作为入口", () => {
  const emptyContents = planNestedImport({
    mode: "contents",
    droppedFolders: ["D:\\Empty"],
    droppedFiles: [],
    expandedFiles: [],
  });
  assert.deepEqual(emptyContents.paths, []);
  assert.deepEqual(emptyContents.hideFromAllPaths, []);

  const emptyBoth = planNestedImport({
    mode: "both",
    droppedFolders: ["D:\\Empty"],
    droppedFiles: [],
    expandedFiles: [],
  });
  assert.deepEqual(emptyBoth.paths, ["D:\\Empty"]);
  assert.deepEqual(emptyBoth.hideFromAllPaths, []);
});

test("contents 有文件时由路径推出投放根，不另增扫描方式", () => {
  const plan = planNestedImport({
    mode: "contents",
    droppedFolders: ["D:\\Work\\Docs"],
    droppedFiles: [],
    expandedFiles: ["D:\\Work\\Docs\\Sub\\a.txt"],
  });
  assert.ok(plan.paths.includes("D:\\Work\\Docs"), "中间目录含投放根，All 才有浏览入口");
  assert.ok(plan.paths.includes("D:\\Work\\Docs\\Sub"));
  assert.ok(!plan.hideFromAllPaths.includes("D:\\Work\\Docs"));
});

test("关键词 OR 与类型筛选都不写成标签；OR 查询只关打标", () => {
  const orQuery = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [8],
    excludedTagIds: [],
    searchQuery: "alpha OR beta",
  });
  assert.equal(orQuery.cabinetId, 2);
  assert.deepEqual(orQuery.tagIds, []);
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


test("导入上下文条：普通柜与标签说清楚落点", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 2,
    cabinets: [{ id: 2, folder_path: null }],
    selectedTagIds: [8],
    excludedTagIds: [],
    searchQuery: "",
  });
  assert.equal(
    importPlacementBanner({ placement, cabinetName: "春季活动", tagNames: ["紧急"] }),
    "将加入文件柜「春季活动」，并打上标签「紧急」。",
  );
  assert.equal(
    importPlacementBanner({ placement: { ...placement, tagIds: [] }, cabinetName: "春季活动", tagNames: [] }),
    "将加入文件柜「春季活动」。",
  );
  assert.equal(
    importPlacementBanner({ placement: { cabinetId: null, tagIds: [1], linkedCabinetBlocked: false }, cabinetName: null, tagNames: ["工作"] }),
    "将打上标签「工作」。",
  );
  assert.equal(
    importPlacementBanner({ placement: { cabinetId: null, tagIds: [], linkedCabinetBlocked: false }, cabinetName: null, tagNames: [] }),
    null,
  );
});

test("导入上下文条：关联柜说明不会自动入柜", () => {
  const placement = snapshotImportPlacement({
    selectedCabinetId: 3,
    cabinets: [{ id: 3, folder_path: "D:\\Photos" }],
    selectedTagIds: [],
    excludedTagIds: [],
    searchQuery: "",
  });
  const text = importPlacementBanner({ placement, cabinetName: "相册", tagNames: [] });
  assert.ok(text && text.includes("关联文件夹「相册」"));
  assert.ok(text && text.includes("不会自动加入该柜"));
});

await run("importContext");
