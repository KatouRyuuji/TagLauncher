import { assert, test, run } from "./__testutil";
import { browseCrumbs, currentBrowseDir, isUnderDir, itemsInDir, parentBrowseDir, parentDir } from "./cabinetBrowse";

const root = "D:\\Photos";
const items = [
  { id: 1, path: "D:\\Photos\\a.jpg" },
  { id: 2, path: "D:\\Photos\\2024" },
  { id: 3, path: "D:\\Photos\\2024\\b.jpg" },
  { id: 4, path: "d:/photos/2024/Trip/c.jpg" },
];

test("parentDir 统一分隔符", () => {
  assert.equal(parentDir("d:/photos/2024/x.jpg"), "d:\\photos\\2024");
  assert.equal(parentDir("D:\\a.jpg"), "D:");
});

test("itemsInDir 只保留直接子项，大小写与分隔符不敏感", () => {
  assert.deepEqual(itemsInDir(items, root).map((item) => item.id), [1, 2]);
  assert.deepEqual(itemsInDir(items, "D:\\PHOTOS\\2024").map((item) => item.id), [3]);
  assert.deepEqual(itemsInDir(items, "D:\\Photos\\2024\\trip").map((item) => item.id), [4]);
});

test("盘符根目录也能逐层浏览", () => {
  assert.deepEqual(itemsInDir([{ path: "D:\\a.jpg" }, { path: "D:\\x\\b.jpg" }], "D:\\").map((item) => item.path), ["D:\\a.jpg"]);
});

test("isUnderDir 不把同前缀的兄弟目录算作子目录", () => {
  assert.equal(isUnderDir("D:\\Photos2\\a.jpg", root), false);
  assert.equal(isUnderDir("D:\\Photos", root), false);
  assert.equal(isUnderDir("d:/photos/2024", root), true);
});

test("currentBrowseDir 遇到不属于关联文件夹的目录回到根", () => {
  assert.equal(currentBrowseDir(root, null), "D:\\Photos");
  assert.equal(currentBrowseDir(root, "E:\\Other"), "D:\\Photos");
  assert.equal(currentBrowseDir(root, "D:\\Photos\\2024\\"), "D:\\Photos\\2024");
});

test("parentBrowseDir 逐级返回，根上返回 undefined", () => {
  assert.equal(parentBrowseDir(root, null), undefined);
  assert.equal(parentBrowseDir(root, "D:\\Photos\\2024"), null);
  assert.equal(parentBrowseDir(root, "D:\\Photos\\2024\\Trip"), "D:\\Photos\\2024");
});

test("browseCrumbs 从文件柜名起逐级列出", () => {
  assert.deepEqual(browseCrumbs("照片", root, null), [{ label: "照片", dir: null }]);
  assert.deepEqual(browseCrumbs("照片", root, "D:\\Photos\\2024\\Trip"), [
    { label: "照片", dir: null },
    { label: "2024", dir: "D:\\Photos\\2024" },
    { label: "Trip", dir: "D:\\Photos\\2024\\Trip" },
  ]);
});

await run("cabinetBrowse");
