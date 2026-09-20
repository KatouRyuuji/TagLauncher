import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert, test, run } from "./__testutil";
import { WORKSPACE_KEY_BLOCKING_OVERLAYS, gridOverscanRows } from "./workspaceChrome";

const OVERLAY_FILES = [
  "src/components/AiTaggingModal.tsx",
  "src/components/BatchSelectionToolbar.tsx",
  "src/components/CommandPalette.tsx",
  "src/components/ContextMenu.tsx",
  "src/components/FloatingPanels.tsx",
  "src/components/ItemTagsEditor.tsx",
  "src/components/MigrationDialog.tsx",
  "src/components/ModManagerPanel.tsx",
  "src/components/QuickPreview.tsx",
  "src/components/AddFolderImportDialog.tsx",
  "src/components/MissingItemsReviewDialog.tsx",
  "src/components/RemoveFromAppConfirmDialog.tsx",
  "src/components/SettingsPanel.tsx",
  "src/components/ShortcutsHelp.tsx",
  "src/components/TagEditor.tsx",
  "src/components/TagGraphView.tsx",
  "src/components/TagRelationsEditor.tsx",
  "src/components/WelcomeModal.tsx",
];

test("示例 Mod 的 P 键遮罩查询与宿主常量一致", () => {
  const source = readFileSync(resolve(process.cwd(), "ExampleMod/preview/preview.js"), "utf-8");
  assert.ok(
    source.includes(WORKSPACE_KEY_BLOCKING_OVERLAYS),
    "preview.js 须包含 WORKSPACE_KEY_BLOCKING_OVERLAYS，避免 P 键穿透宿主遮罩",
  );
});

test("全屏弹层带 data-workspace-overlay，避免漏标后 P 键穿透", () => {
  for (const file of OVERLAY_FILES) {
    const source = readFileSync(resolve(process.cwd(), file), "utf-8");
    assert.ok(source.includes("data-workspace-overlay"), `${file} 缺少 data-workspace-overlay`);
  }
});

test("欢迎页与命令面板眉题为中文，快捷键完整显示", () => {
  const welcome = readFileSync(resolve(process.cwd(), "src/components/WelcomeModal.tsx"), "utf-8");
  const palette = readFileSync(resolve(process.cwd(), "src/components/CommandPalette.tsx"), "utf-8");
  assert.ok(welcome.includes("欢迎使用 TagLauncher"), "欢迎页眉题应为中文");
  assert.ok(!welcome.includes("Capabilities"), "欢迎页不应残留英文 Capabilities");
  assert.ok(palette.includes("命令 / 项目"), "命令面板分组应为中文");
  // 键盘提示收在底栏状态行；输入行的 Ctrl+K 徽章已移除（面板已打开，提示冗余）
  assert.ok(palette.includes("↑↓ 选择 · Enter 执行 · Esc 关闭"), "命令面板底栏应显示键盘提示");
  assert.ok(!palette.includes(">Ctrl K<"), "不得使用缺加号的 Ctrl K");
});

test("gridOverscanRows：列数越多 overscan 行数越少，且始终 ≥2", () => {
  assert.equal(gridOverscanRows(1), 6);
  assert.equal(gridOverscanRows(2), 4);
  assert.equal(gridOverscanRows(3), 3);
  assert.equal(gridOverscanRows(4), 3);
  assert.equal(gridOverscanRows(6), 2);
  assert.equal(gridOverscanRows(12), 2);
});

test("gridOverscanRows：非法输入（0/负数/NaN）按单列兜底", () => {
  assert.equal(gridOverscanRows(0), 6);
  assert.equal(gridOverscanRows(-3), 6);
  assert.equal(gridOverscanRows(Number.NaN), 6);
});

await run("workspaceChrome");
