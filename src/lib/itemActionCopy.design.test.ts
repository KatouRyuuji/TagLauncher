import { assert, test, run } from "./__testutil";
import {
  cardOpenLabel,
  deleteFilesDialogTitle,
  deleteFilesLabel,
  folderTypeBadge,
  libraryRemoveLabel,
  libraryRemoveNotDeleteHint,
  batchAddTagTargetCopy,
  tagAlreadyOwnedTitle,
  tagFilterPlaceholder,
  openMenuLabel,
  parentDirectoryPath,
  pathBasename,
  relocateNoneCopy,
  relocateRecoveredCopy,
  removeFromLibraryDialogTitle,
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

test("多选右键第一项写打开 N 项，单选仍是打开", () => {
  assert.equal(openMenuLabel("video", 1), "打开");
  assert.equal(openMenuLabel("folder", 1), "打开此文件夹");
  assert.equal(openMenuLabel("video", 3), "打开 3 项");
  assert.equal(openMenuLabel("folder", 2), "打开 2 项");
  assert.equal(libraryRemoveNotDeleteHint, "从库中移除 ≠ 删除本地文件");
});

test("批量加标签菜单：将加到 N 个对象、已全部拥有、过滤占位", () => {
  assert.equal(batchAddTagTargetCopy(1), "将加到 1 个对象");
  assert.equal(batchAddTagTargetCopy(11), "将加到 11 个对象");
  assert.equal(tagAlreadyOwnedTitle, "已全部拥有");
  assert.equal(tagFilterPlaceholder, "过滤标签");
});

test("卡片主按钮：脚本说启动，文件夹说打开", () => {
  assert.equal(cardOpenLabel("exe"), "启动");
  assert.equal(cardOpenLabel("folder"), "打开");
  assert.equal(cardOpenLabel("image"), "打开");
});

test("从库中移除与删本地按数量变复数", () => {
  assert.equal(libraryRemoveLabel(1), "从库中移除");
  assert.equal(libraryRemoveLabel(3), "从库中移除 3 项");
  assert.equal(deleteFilesLabel(1), "删除本地文件");
  assert.equal(deleteFilesLabel(2), "删除 2 个本地文件");
});

test("确认框标题：默认移出库，删盘入口才写删除本地文件", () => {
  assert.equal(removeFromLibraryDialogTitle(1), "移出库");
  assert.equal(removeFromLibraryDialogTitle(3), "移出库 3 项");
  assert.equal(deleteFilesDialogTitle(1), "删除本地文件");
  assert.equal(deleteFilesDialogTitle(4), "删除本地文件 4 项");
  assert.equal(folderTypeBadge, "文件夹");
});

test("失效找回结果写在行上", () => {
  assert.ok(relocateNoneCopy().includes("没有找回任何项目"));
  assert.equal(relocateRecoveredCopy(2), "已找回 2 项");
});

test("上一级路径与夹名", () => {
  assert.equal(parentDirectoryPath("C:\\Users\\Ryu\\Documents\\工作文档"), "C:\\Users\\Ryu\\Documents");
  assert.equal(parentDirectoryPath("D:/Photos/旅行照片/"), "D:/Photos");
  assert.equal(parentDirectoryPath("C:\\"), null);
  assert.equal(pathBasename("D:\\Photos\\旅行照片"), "旅行照片");
});

await run("itemActionCopy");
