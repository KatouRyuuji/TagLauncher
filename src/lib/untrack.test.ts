import { assert, test, run } from "./__testutil";
import { planUntrack, watchRootPaths } from "./untrack";

const items = [
  { id: 1, path: "D:\\Watch", type: "folder" },
  { id: 2, path: "D:\\Watch\\a.mp4", type: "video" },
  { id: 3, path: "D:\\Watch\\Sub", type: "folder" },
  { id: 4, path: "d:/watch/sub/b.png", type: "image" },
  { id: 5, path: "D:\\Watched\\c.txt", type: "file" },
  { id: 6, path: "E:\\Shelf\\x.txt", type: "file" },
];

test("监视目录：打开监视的文件夹对象与关联柜文件夹", () => {
  assert.deepEqual(watchRootPaths(items, [1], [{ folder_path: null }, { folder_path: "E:\\Shelf" }]), ["D:\\Watch", "E:\\Shelf"]);
});

test("不再追踪：只算监视目录之下的对象，目录本身与形似路径不算", () => {
  const roots = ["D:\\Watch"];
  assert.deepEqual(planUntrack([1, 5], items, roots), { untrackedCount: 0, extraIds: [] });
  assert.deepEqual(planUntrack([2], items, roots), { untrackedCount: 1, extraIds: [] });
});

test("不再追踪文件夹：其下已入库对象随之移出（大小写与分隔符不敏感）", () => {
  assert.deepEqual(planUntrack([3], items, ["D:\\Watch"]), { untrackedCount: 1, extraIds: [4] });
  assert.deepEqual(planUntrack([3, 4], items, ["D:\\Watch"]), { untrackedCount: 2, extraIds: [] });
});

await run("untrack");
