// ============================================================================
// scripts/demo-screenshots.mjs — 演示模式自动截图工具
// ============================================================================
// 启动 demo 模式（浏览器内 mock 后端，见 src/demo/），用 Playwright 驱动 UI，
// 以樱花粉主题全覆盖遍历全部功能特性截图；3 个官方主题另各截主界面并列展示。
//
// 用法：
//   npm run demo:shots            # 截图到 screenshots/（本地目录，不上云）
//   node scripts/demo-screenshots.mjs --out my-shots --port 5200
//
// 注意：截图产物输出到本地目录（默认 screenshots/，已 gitignore）；
// 本工具与 src/demo/ 随仓库分发，任何人 clone 后均可复现同一套截图。
// ============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const OUT_DIR = path.resolve(argValue("out", "screenshots"));
const PORT = Number(argValue("port", "5199"));
const BASE = `http://127.0.0.1:${PORT}`;
const THEMES = ["sakura", "dark", "cyber-cyan"];

// ---- 小工具 ----

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const file = path.join(OUT_DIR, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✔ ${path.basename(file)}`);
}
/** 等待 mock IPC 延迟 + React 渲染 + 过渡动画稳定 */
const settle = (ms = 450) => sleep(ms);

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // 尚未就绪
    }
    await sleep(400);
  }
  return false;
}

async function ensureServer() {
  if (await waitForServer(BASE, 1_500)) {
    console.log(`复用已运行的 demo 服务器 ${BASE}`);
    return null;
  }
  console.log(`启动 demo 服务器（vite --mode demo, 端口 ${PORT}）…`);
  const child = spawn(
    process.execPath,
    [path.resolve("node_modules/vite/bin/vite.js"), "--mode", "demo", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { stdio: "ignore", cwd: process.cwd() },
  );
  if (!(await waitForServer(BASE))) {
    child.kill();
    throw new Error("demo 服务器启动超时");
  }
  return child;
}

// ---- 页面动作 ----

async function clearSearch(page) {
  const input = page.locator('[data-region="searchbar"] input');
  await input.click();
  await input.fill("");
  await settle(500);
}

async function closeOverlays(page) {
  await page.keyboard.press("Escape");
  await settle(250);
}

async function openSettings(page) {
  await page.locator('button[title="设置"]').click();
  await page.locator('div[role="dialog"][aria-label="设置"]').waitFor();
  await settle();
}

async function closeSettings(page) {
  await closeOverlays(page);
  await page.locator('div[role="dialog"][aria-label="设置"]').waitFor({ state: "detached" });
}

async function scrollSettingsTo(page, chipLabel) {
  await page.locator('nav[aria-label="设置区块导航"] button', { hasText: chipLabel }).click();
  await settle(600);
}

async function selectTheme(page, themeId) {
  const dialog = page.locator('div[role="dialog"][aria-label="设置"]');
  await dialog.locator("select").first().selectOption(themeId);
  await settle(600);
}

/** 右键会联动选中卡片 → 弹出批量工具条；演示后清理，避免污染后续截图 */
async function clearSelection(page) {
  const btn = page.getByRole("button", { name: "取消选择" });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await settle(300);
  }
}

function itemCard(page, name) {
  return page.locator('[data-region="main"] h3', { hasText: name }).first();
}

async function rightClickItem(page, name) {
  await itemCard(page, name).click({ button: "right" });
  await settle(300);
}

async function clickMenu(page, label) {
  await page.getByText(label, { exact: true }).last().click();
  await settle();
}

// ---- 功能特性巡演（樱花粉主题全覆盖） ----

async function featureTour(page) {
  // 01 欢迎页（首次进入自动弹出）
  await page.getByText("开始使用").waitFor();
  await settle();
  await shot(page, "welcome-欢迎页");
  await page.getByRole("button", { name: "开始使用" }).click();
  await settle();

  // 02 网格视图
  await shot(page, "workspace-grid-主界面-网格视图");

  // 03 列表视图
  await page.locator('button[title="列表视图"]').click();
  await settle();
  await shot(page, "workspace-list-主界面-列表视图");
  await page.locator('button[title="网格视图"]').click();
  await settle();

  // 04 搜索 - 关键词
  const search = page.locator('[data-region="searchbar"] input');
  await search.click();
  await search.fill("音乐");
  await settle(800);
  await shot(page, "search-keyword-搜索-关键词");

  // 05 搜索 - 拼音（zjl → 周杰伦）
  await search.fill("zjl");
  await settle(800);
  await shot(page, "search-pinyin-搜索-拼音首字母");
  await clearSearch(page);

  // 06 标签筛选（父标签并入后代对象）
  await page.locator('[data-region="sidebar-nav"] >> text=音乐').first().click();
  await settle();
  await shot(page, "filter-tag-标签筛选-父标签含后代");

  // 07 标签多选交集（开发 ∩ 自动化）
  await page.locator('[data-region="sidebar-nav"] >> text=音乐').first().click();
  await page.locator('[data-region="sidebar-nav"] >> text=开发').first().click();
  await page.locator('[data-region="sidebar-nav"] >> text=自动化').first().click();
  await settle();
  await shot(page, "filter-tag-multi-标签多选交集");
  await page.locator('[data-region="sidebar-nav"] >> text=开发').first().click();
  await page.locator('[data-region="sidebar-nav"] >> text=自动化').first().click();
  await settle(300);

  // 08-10 收藏夹 / 最近使用 / 文件柜（均在侧栏「文件夹」页签内）
  await page.locator('[data-region="sidebar"] button:has-text("文件夹")').first().click();
  await settle(300);

  // 08 收藏夹
  await page.locator('[data-region="sidebar-nav"] button:has-text("收藏夹")').click();
  await settle();
  await shot(page, "filter-favorites-收藏夹");
  await page.locator('[data-region="sidebar-nav"] button:has-text("收藏夹")').click();
  await settle(300);

  // 09 最近使用
  await page.locator('[data-region="sidebar-nav"] button:has-text("最近使用")').click();
  await settle();
  await shot(page, "filter-recent-最近使用");
  await page.locator('[data-region="sidebar-nav"] button:has-text("最近使用")').click();
  await settle(300);

  // 10 文件柜
  await page.locator('[data-drop-item-cabinet-id="1"]').click();
  await settle();
  await shot(page, "filter-cabinet-文件柜视图");
  await page.locator('[data-drop-item-cabinet-id="1"]').click();
  await page.locator('[data-region="sidebar"] button:has-text("标签")').first().click();
  await settle(300);

  // 11 命令面板
  await page.keyboard.press("Control+k");
  await settle();
  await page.keyboard.type("chrome", { delay: 30 });
  await settle(500);
  await shot(page, "command-palette-命令面板");
  await closeOverlays(page);

  // 12 快速预览 - 图片
  await rightClickItem(page, "青海湖日落");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-image-快速预览-图片");
  await closeOverlays(page);
  await clearSelection(page);

  // 13 快速预览 - 音频（专辑封面 + 元数据）
  await rightClickItem(page, "周杰伦 - 晴天");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-audio-快速预览-音频");
  await closeOverlays(page);
  await clearSelection(page);

  // 14 快速预览 - 文件夹（目录列表）
  await rightClickItem(page, "工作文档");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-folder-快速预览-文件夹");
  await closeOverlays(page);
  await clearSelection(page);

  // 15 右键菜单
  await rightClickItem(page, "原神");
  await shot(page, "context-menu-右键菜单");

  // 16 标签编辑器
  await clickMenu(page, "管理标签");
  await settle(600);
  await shot(page, "tags-editor-标签编辑器");
  await closeOverlays(page);
  await closeOverlays(page);
  await clearSelection(page);

  // 17 框选批量操作（在网格空白处拖出选区）
  const grid = page.locator('[data-region="main"]');
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 80, box.y + 520, { steps: 12 });
  await settle(300);
  await shot(page, "selection-drag-框选批量选择");
  await page.mouse.up();
  await settle(300);
  await shot(page, "batch-toolbar-批量操作工具条");
  // 清空选择
  await page.keyboard.press("Escape");
  await settle(300);

  // 18 标签图谱
  await page.locator('[data-region="sidebar"] button:has-text("图谱")').first().click();
  await settle(900);
  await shot(page, "tag-graph-标签关系图谱");
  await closeOverlays(page);

  // 19-25 设置面板各区块
  await openSettings(page);
  await shot(page, "settings-theme-设置-主题外观");
  await scrollSettingsTo(page, "AI");
  await shot(page, "settings-ai-设置-AI自动打标");

  // 21 AI 一键打标（mock 建议 → 真实编排进度）
  await page.getByRole("button", { name: "为全部对象打标" }).click();
  await page.getByText("打标完成").waitFor({ timeout: 60_000 });
  await settle(400);
  await shot(page, "ai-tagging-AI批量打标");
  await page.getByRole("button", { name: "完成" }).click();
  await settle();

  await scrollSettingsTo(page, "数据管理");
  await shot(page, "settings-data-设置-数据管理");
  await scrollSettingsTo(page, "云同步");
  await shot(page, "settings-sync-设置-云同步");
  await scrollSettingsTo(page, "更新");
  await shot(page, "settings-update-设置-在线更新");
  await scrollSettingsTo(page, "扩展");
  await shot(page, "settings-mods-设置-扩展Mod管理");
  await closeSettings(page);

  // 26 快捷键帮助
  await page.keyboard.press("Control+/");
  await settle();
  await shot(page, "shortcuts-help-快捷键帮助");
  await closeOverlays(page);

  // 27 失效对象找回（状态栏徽标 → toast 反馈）
  await page.getByText("个失效 · 尝试找回").click();
  await settle(900);
  await shot(page, "missing-relocate-失效对象找回反馈");
}

// ---- 主题巡演：仅并列展示各官方主题的主界面（功能截图由樱花粉全覆盖） ----

async function themeTour(page) {
  for (const themeId of THEMES) {
    await openSettings(page);
    await selectTheme(page, themeId);
    await closeSettings(page);
    await shot(page, `theme-${themeId}-grid-主界面`);
  }
  // 巡演结束后回到演示主用主题（樱花粉），便于人工接续体验
  await openSettings(page);
  await selectTheme(page, "sakura");
  await closeSettings(page);
}

// ---- 主流程 ----

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.warn("  [pageerror]", err.message));

    console.log("打开 demo 应用…");
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.locator('[data-region="root"]').waitFor();

    console.log("功能特性巡演：");
    await featureTour(page);
    console.log("主题巡演：");
    await themeTour(page);
    console.log(`\n完成：${shotIndex} 张截图 → ${OUT_DIR}`);
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
