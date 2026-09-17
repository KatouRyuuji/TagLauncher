import { assert, test, run } from "./__testutil";
import {
  cardOpenLabel,
  deleteFilesLabel,
  libraryRemoveLabel,
  openMenuLabel,
  parentDirectoryPath,
  pathBasename,
  revealFailedToast,
  revealMenuLabel,
} from "./itemActionCopy";

test("文件夹与文件的打开 / 揭示用词分开", () => {
  assert.equal(openMenuLabel("folder"), "打开此文件夹");
  assert.equal(openMenuLabel("video"), "打开");
  assert.equal(revealMenuLabel("folder"), "打开上一级");
  assert.equal(revealMenuLabel("image"), "打开所在文件夹");
  assert.ok(revealFailedToast("folder").includes("上一级"));
});

test("卡片主按钮：脚本说启动，文件夹说打开", () => {
  assert.equal(cardOpenLabel("exe"), "启动");
  assert.equal(cardOpenLabel("folder"), "打开");
  assert.equal(cardOpenLabel("image"), "打开");
});

test("仅出库与删本地按数量变复数", () => {
  assert.equal(libraryRemoveLabel(1), "仅出库");
  assert.equal(libraryRemoveLabel(3), "仅出库 3 项");
  assert.equal(deleteFilesLabel(1), "删除本地文件");
  assert.equal(deleteFilesLabel(2), "删除 2 个本地文件");
});

test("上一级路径与夹名", () => {
  assert.equal(parentDirectoryPath("C:\\Users\\Ryu\\Documents\\工作文档"), "C:\\Users\\Ryu\\Documents");
  assert.equal(parentDirectoryPath("D:/Photos/旅行照片/"), "D:/Photos");
  assert.equal(parentDirectoryPath("C:\\"), null);
  assert.equal(pathBasename("D:\\Photos\\旅行照片"), "旅行照片");
});

await run("itemActionCopy");
