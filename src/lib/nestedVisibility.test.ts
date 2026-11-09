import { assert, test, run } from "./__testutil";
import {
  applyNestedVisibility,
  browseTargetForItem,
  hasLibraryDescendants,
  libraryBrowseDirOf,
  nearestBrowseRoot,
  shouldRevealNested,
} from "./nestedVisibility";

const hidden = { id: 2, name: "a.txt", path: "D:\\Lib\\Folder\\a.txt", type: "exe" as const, hide_from_all: true };
const folder = { id: 1, name: "Folder", path: "D:\\Lib\\Folder", type: "folder" as const, hide_from_all: false };
const nestedDir = { id: 3, name: "Sub", path: "D:\\Lib\\Folder\\Sub", type: "folder" as const, hide_from_all: true };
const otherCab = { id: 4, name: "shared.exe", path: "D:\\shared.exe", type: "exe" as const, hide_from_all: true };
const loose = { id: 5, name: "loose.exe", path: "D:\\loose.exe", type: "exe" as const, hide_from_all: false };

const allClosed = {
  showNestedContents: false,
  hasSearchQuery: false,
  selectedTagIds: [] as number[],
  excludedTagIds: [] as number[],
  selectedCabinetId: null as number | null,
  showFavorites: false,
  showRecent: false,
  libraryBrowseRoot: null as string | null,
};

test("All 默认藏起 hide_from_all，旧散文件（未打标）仍可见", () => {
  const listed = applyNestedVisibility([folder, hidden, loose], shouldRevealNested(allClosed));
  assert.deepEqual(listed.map((item) => item.id), [1, 5]);
});

test("显示目录内文件 / 搜索 / 标签 / 柜 / 收藏 / 最近 / 库内浏览都会揭示隐藏项", () => {
  const items = [folder, hidden];
  const cases = [
    { ...allClosed, showNestedContents: true },
    { ...allClosed, hasSearchQuery: true },
    { ...allClosed, selectedTagIds: [1] },
    { ...allClosed, excludedTagIds: [2] },
    { ...allClosed, selectedCabinetId: 7 },
    { ...allClosed, showFavorites: true },
    { ...allClosed, showRecent: true },
    { ...allClosed, libraryBrowseRoot: "D:\\Lib\\Folder" },
  ];
  for (const input of cases) {
    assert.equal(applyNestedVisibility(items, shouldRevealNested(input)).length, 2, JSON.stringify(input));
  }
});

test("仅类型筛选不揭示：类型过滤发生在可见性之后由调用方处理，本层仍隐藏", () => {
  assert.equal(shouldRevealNested(allClosed), false);
});

test("关切换不丢对象：揭示后再藏回，集合只是过滤", () => {
  const source = [folder, hidden, loose];
  const shown = applyNestedVisibility(source, true);
  const hiddenAgain = applyNestedVisibility(shown, false);
  assert.equal(shown.length, 3);
  assert.deepEqual(hiddenAgain.map((item) => item.id), [1, 5]);
});

test("多柜：因总览隐藏不会把同一对象从柜视图抹掉（柜视图 reveal=true）", () => {
  const cabinetItems = applyNestedVisibility([otherCab, loose], shouldRevealNested({ ...allClosed, selectedCabinetId: 2 }));
  assert.equal(cabinetItems.length, 2);
});

test("库内浏览只展示当前层，搜索时退出目录层以便命中隐藏文件", () => {
  const dir = libraryBrowseDirOf("D:\\Lib\\Folder", "D:\\Lib\\Folder\\Sub", {
    hasSearchQuery: false,
    selectedTagIds: [],
    excludedTagIds: [],
  });
  assert.equal(dir, "D:\\Lib\\Folder\\Sub");
  const searching = libraryBrowseDirOf("D:\\Lib\\Folder", "D:\\Lib\\Folder\\Sub", {
    hasSearchQuery: true,
    selectedTagIds: [],
    excludedTagIds: [],
  });
  assert.equal(searching, null);
});

test("有库内后代的文件夹进入逐级浏览；隐藏文件导航到所在目录", () => {
  const items = [folder, nestedDir, hidden, loose];
  assert.equal(hasLibraryDescendants(folder.path, items, folder.id), true);
  assert.deepEqual(browseTargetForItem(folder, items), { root: "D:\\Lib\\Folder", dir: null });
  assert.deepEqual(browseTargetForItem(hidden, items), {
    root: "D:\\Lib\\Folder",
    dir: "D:\\Lib\\Folder",
  });
  assert.equal(browseTargetForItem(loose, items), null);
});

test("最近可见根取最长前缀，不把其他柜的路径当根", () => {
  assert.equal(nearestBrowseRoot(hidden.path, [folder, nestedDir, loose]), "D:\\Lib\\Folder");
});

await run("nestedVisibility");
