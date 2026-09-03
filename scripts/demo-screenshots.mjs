// ============================================================================
// scripts/demo-screenshots.mjs — 全功能 UI 交互测试 + 全形态截图
// ============================================================================
// 启动 demo 模式（浏览器内 mock 后端 + 10 个全覆盖模拟对象，见 src/demo/），
// 用 Playwright 驱动真实 UI 交互，逐特性断言行为正确（check 计数，失败以
// 退出码 1 结束），并在每个形态落截图。
//
// 覆盖：欢迎页 / 网格 / 列表 / 关键词·拼音·表达式搜索 / 类型筛选 / 标签 DAG
// 筛选（父并入后代、多选交集）/ 收藏 / 最近使用 / 文件柜 / 排序 / 命令面板 /
// 快速预览（图片·音频·文件夹）/ 右键菜单 / 标签编辑 / 框选与批量工具条 /
// 标签关系编辑 / 标签图谱 / 设置六区块 / AI 打标 / 快捷键帮助 / F3 /
// 失效找回 / 空态；主题形态：7 配色家族 × 亮/暗 + 霜靛亮/暗列表。
//
// 用法：
//   npm run demo:shots            # 测试 + 截图到 screenshots/（本地目录，不上云）
//   node scripts/demo-screenshots.mjs --out my-shots --port 5200
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

// ---- 断言收集（软断言：全部跑完后统一汇报，失败退出码 1） ----

let passCount = 0;
let failCount = 0;
async function check(name, probe) {
  try {
    const value = typeof probe === "function" ? await probe() : await probe;
    if (value) {
      passCount += 1;
      console.log(`  ✓ ${name}`);
    } else {
      failCount += 1;
      console.log(`  ✗ ${name}`);
    }
  } catch (err) {
    failCount += 1;
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}
const itemCount = (page) => page.locator('[data-region="main"] [data-selectable-item-id]').count();
const statusText = (page) => page.locator('[data-region="statusbar"]').textContent();

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
  const input = page.locator("#workspace-search");
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
  await page.getByRole("dialog", { name: "设置工作台" }).waitFor();
  await settle();
}

async function closeSettings(page) {
  await closeOverlays(page);
  await page.getByRole("dialog", { name: "设置工作台" }).waitFor({ state: "detached" });
}

async function scrollSettingsTo(page, chipLabel) {
  await page.locator('nav[aria-label="设置区块导航"] button', { hasText: chipLabel }).click();
  await settle(600);
}

async function selectTheme(page, themeLabel) {
  const dialog = page.getByRole("dialog", { name: "设置工作台" });
  // 主题选择器为自绘 SelectMenu：点开按钮后按选项文本选择
  await dialog.locator('button[aria-label="当前主题"]').click();
  await settle(250);
  await dialog.locator('[role="option"]', { hasText: themeLabel }).first().click();
  await settle(600);
}

/** 当前是否为暗色（窗口栏模式按钮的 aria-label 随状态变化） */
async function isDarkMode(page) {
  return (await page.locator('button[aria-label="切换到亮色模式"]').count()) > 0;
}

async function setMode(page, wantDark) {
  if ((await isDarkMode(page)) !== wantDark) {
    await page.locator(`button[aria-label="${wantDark ? "切换到暗色模式" : "切换到亮色模式"}"]`).click();
    await settle(500);
  }
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

async function sidebarTag(page, name) {
  await page.locator(`[data-region="sidebar-nav"] button:has-text("${name}")`).first().click();
  await settle(400);
}

// ---- 功能特性巡演（霜靛主题全覆盖，逐特性断言） ----

async function featureTour(page) {
  // 01 欢迎页（首次进入自动弹出）
  await page.getByText("开始使用").waitFor();
  await settle();
  await shot(page, "welcome-欢迎页");
  await check("欢迎页弹出", page.getByRole("button", { name: "开始使用" }).isVisible());
  await page.getByRole("button", { name: "开始使用" }).click();
  await settle();

  // 02 网格视图
  await shot(page, "workspace-grid-主界面-网格视图");
  await check("网格视图渲染 10 个对象", (await itemCount(page)) === 10);
  await check("状态栏计数 10 项", (await statusText(page))?.includes("10 项"));
  await check("失效对象徽标可见", page.locator("[data-selectable-item-id]").filter({ hasText: "影视收藏" }).getByText("失效", { exact: true }).isVisible());

  // 03 列表视图（全幅表格 + 表头）
  await page.locator('button[title="列表视图"]').click();
  await settle();
  await shot(page, "workspace-list-主界面-列表视图");
  await check("列表视图渲染 10 行", (await itemCount(page)) === 10);
  await check("列表表头含名称/标签/类型", page.locator('button:has-text("名称")').first().isVisible());

  // 03b 表头点击排序（按名称）→ 再点回智能
  await page.locator('[data-region="item-list"] button:has-text("名称")').click();
  await settle(400);
  await check("表头排序后首行是工作文档（zh-CN 排序中文在前）",
    (await page.locator('[data-region="main"] [data-selectable-item-id] h3').first().textContent())?.includes("工作文档"));
  await page.locator('[data-region="item-list"] button:has-text("名称")').click();
  await settle(400);
  await page.locator('button[title="网格视图"]').click();
  await settle();

  // 04 搜索 - 关键词
  const search = page.locator("#workspace-search");
  await search.click();
  await search.fill("晴天");
  await settle(800);
  await shot(page, "search-keyword-搜索-关键词");
  await check("关键词搜索「晴天」命中 1 项", (await itemCount(page)) === 1);

  // 05 搜索 - 拼音首字母（zjl → 周杰伦）
  await search.fill("zjl");
  await settle(800);
  await shot(page, "search-pinyin-搜索-拼音首字母");
  await check("拼音首字母「zjl」命中周杰伦", (await itemCount(page)) === 1);

  // 06 搜索 - 表达式（与/排除）
  await search.fill("开发&&自动化");
  await settle(800);
  await check("表达式「开发&&自动化」命中 2 项", (await itemCount(page)) === 2);
  await search.fill("开发&&!!自动化");
  await settle(800);
  await check("表达式「开发&&!!自动化」命中 1 项", (await itemCount(page)) === 1);

  // 07 搜索 - 无结果空态
  await search.fill("不存在的东西xyz");
  await settle(800);
  await shot(page, "search-empty-搜索无结果空态");
  await check("无结果空态出现", page.getByText(/没有找到|无结果|清空筛选/).first().isVisible());
  await clearSearch(page);
  await check("清空搜索恢复 10 项", (await itemCount(page)) === 10);

  // 08 类型筛选（图片 = 2）
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("图片")').click();
  await settle(500);
  await shot(page, "filter-type-类型筛选-图片");
  await check("类型筛选「图片」命中 2 项", (await itemCount(page)) === 2);
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("图片")').click();
  await settle(400);

  // 09 标签筛选（父标签并入后代对象：娱乐 ⊃ 游戏/音乐/电影 → 3 项）
  await sidebarTag(page, "娱乐");
  await shot(page, "filter-tag-标签筛选-父标签含后代");
  await check("父标签「娱乐」并入后代共 3 项", (await itemCount(page)) === 3);
  await sidebarTag(page, "娱乐");

  // 10 标签多选交集（开发 ∩ 自动化 = 2）
  await sidebarTag(page, "开发");
  await sidebarTag(page, "自动化");
  await shot(page, "filter-tag-multi-标签多选交集");
  await check("「开发 ∩ 自动化」命中 2 项", (await itemCount(page)) === 2);
  await sidebarTag(page, "开发");
  await sidebarTag(page, "自动化");

  // 11-13 收藏夹 / 最近使用 / 文件柜（均在侧栏「文件柜」页签内）
  await page.locator('[data-region="sidebar"] button:has-text("文件柜")').first().click();
  await settle(300);

  await page.locator('[data-region="sidebar-nav"] button:has-text("收藏夹")').click();
  await settle();
  await shot(page, "filter-favorites-收藏夹");
  await check("收藏夹 4 项", (await itemCount(page)) === 4);
  await page.locator('[data-region="sidebar-nav"] button:has-text("收藏夹")').click();
  await settle(300);

  await page.locator('[data-region="sidebar-nav"] button:has-text("最近使用")').click();
  await settle();
  await shot(page, "filter-recent-最近使用");
  await check("最近使用 9 项（失效对象从未启动）", (await itemCount(page)) === 9);
  await page.locator('[data-region="sidebar-nav"] button:has-text("最近使用")').click();
  await settle(300);

  await page.locator('[data-drop-item-cabinet-id="1"]').click();
  await settle();
  await shot(page, "filter-cabinet-文件柜视图");
  await check("文件柜「工作必备」3 项", (await itemCount(page)) === 3);
  await page.locator('[data-drop-item-cabinet-id="1"]').click();
  await page.locator('[data-region="sidebar"] button:has-text("标签")').first().click();
  await settle(300);

  // 14 排序下拉（自绘 SelectMenu）
  await page.locator('button[aria-label="排序方式"]').click();
  await settle(300);
  await shot(page, "sort-menu-排序下拉");
  await check("排序下拉展开 5 个选项", (await page.locator('[role="listbox"] [role="option"]').count()) === 5);
  await page.locator('[role="option"]', { hasText: "名称" }).click();
  await settle(500);
  await check("按名称排序后首项是工作文档（zh-CN 排序中文在前）",
    (await page.locator('[data-region="main"] [data-selectable-item-id] h3').first().textContent())?.includes("工作文档"));
  await page.locator('button[aria-label="排序方式"]').click();
  await settle(250);
  await page.locator('[role="option"]', { hasText: "智能" }).click();
  await settle(400);

  // 15 命令面板
  await page.keyboard.press("Control+k");
  await settle();
  await page.keyboard.type("vscode", { delay: 30 });
  await settle(500);
  await shot(page, "command-palette-命令面板");
  await check("命令面板命中 Visual Studio Code", page.getByText("Visual Studio Code").first().isVisible());
  await closeOverlays(page);

  // 16 F3 聚焦搜索
  await page.keyboard.press("F3");
  await check("F3 聚焦搜索框", await page.evaluate(() => document.activeElement?.id === "workspace-search"));
  await page.keyboard.press("Escape");
  await settle(200);

  // 17 快速预览 - 图片
  await rightClickItem(page, "青海湖日落");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-image-快速预览-图片");
  await closeOverlays(page);
  await clearSelection(page);

  // 18 快速预览 - 音频（专辑封面 + 元数据）
  await rightClickItem(page, "周杰伦 - 晴天");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-audio-快速预览-音频");
  await check("音频预览显示专辑信息", page.getByText("叶惠美").first().isVisible());
  await closeOverlays(page);
  await clearSelection(page);

  // 19 快速预览 - 文件夹（目录列表）
  await rightClickItem(page, "工作文档");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-folder-快速预览-文件夹");
  await check("文件夹预览列出条目", page.getByText("季度汇报.pptx").first().isVisible());
  await closeOverlays(page);
  await clearSelection(page);

  // 20 右键菜单
  await rightClickItem(page, "原神");
  await shot(page, "context-menu-右键菜单");
  await check("右键菜单含打开/快速预览/管理标签", page.getByText("管理标签", { exact: true }).isVisible());

  // 21 对象标签编辑器
  await clickMenu(page, "管理标签");
  await settle(600);
  await shot(page, "tags-editor-对象标签编辑器");
  await closeOverlays(page);
  await closeOverlays(page);
  await clearSelection(page);

  // 22 框选批量操作（从网格左 padding 空白条拖出选区，起点不能落在卡片上）
  const grid = page.locator('[data-region="main"]');
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 80, box.y + 420, { steps: 12 });
  await settle(300);
  await shot(page, "selection-drag-框选批量选择");
  await page.mouse.up();
  await settle(300);
  await shot(page, "batch-toolbar-批量操作工具条");
  await check("批量工具条出现", page.getByRole("button", { name: "取消选择" }).isVisible());
  await page.keyboard.press("Escape");
  await settle(300);

  // 23 标签关系编辑器
  await page.locator('[data-region="sidebar"] button[aria-label="管理标签父子关系"]').click();
  await settle(600);
  await shot(page, "tag-relations-标签关系编辑器");
  await check("标签关系编辑器打开", page.getByRole("dialog", { name: "标签关系" }).isVisible());
  await closeOverlays(page);

  // 24 标签图谱
  await page.locator('[data-region="sidebar"] button[aria-label="打开标签关系图"]').click();
  await settle(900);
  await shot(page, "tag-graph-标签关系图谱");
  await check("标签图谱渲染 LEVEL 分层", page.getByText(/LEVEL/i).first().isVisible());
  await closeOverlays(page);

  // 25-30 设置面板各区块
  await openSettings(page);
  await shot(page, "settings-theme-设置-主题外观");
  await check("设置面板打开", page.getByRole("dialog", { name: "设置工作台" }).isVisible());
  await scrollSettingsTo(page, "AI");
  await shot(page, "settings-ai-设置-AI自动打标");

  // 26 AI 一键打标（mock 建议 → 真实编排进度）
  await page.getByRole("button", { name: "为全部对象打标" }).click();
  await page.getByText("打标完成").waitFor({ timeout: 60_000 });
  await settle(400);
  await shot(page, "ai-tagging-AI批量打标");
  await check("AI 打标完成", page.getByText("打标完成").isVisible());
  await page.getByRole("dialog", { name: "AI 打标进度" }).getByRole("button", { name: "完成" }).click();
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

  // 31 快捷键帮助
  await page.keyboard.press("?");
  await settle();
  await shot(page, "shortcuts-help-快捷键帮助");
  await check("快捷键帮助含 F3 条目", page.getByText(/F3/).first().isVisible());
  await closeOverlays(page);

  // 32 失效对象找回（状态栏徽标 → toast 反馈）
  await page.getByText("个失效 · 尝试找回").click();
  await settle(900);
  await shot(page, "missing-relocate-失效对象找回反馈");
}

// ---- 主题形态巡演：7 配色家族 × 亮/暗 网格 + 霜靛亮/暗列表 ----

async function themeTour(page) {
  // 等上一步（失效找回）的 toast 驻留期结束，避免带入主题截图
  await page.locator(".toast-enter").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await settle(500);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "设置工作台" });
  // 收集「内置主题」分组下全部配色家族名（自绘 SelectMenu 的 option 文本）
  await dialog.locator('button[aria-label="当前主题"]').click();
  await settle(250);
  const themeLabels = await dialog.locator('[role="listbox"] [role="option"]').evaluateAll(
    (options) => options.map((option) => option.textContent?.trim() ?? ""),
  );
  await page.keyboard.press("Escape");
  await closeSettings(page);
  console.log(`  共 ${themeLabels.length} 套配色家族 × 亮/暗`);

  for (const themeLabel of themeLabels) {
    await openSettings(page);
    await selectTheme(page, themeLabel);
    await closeSettings(page);
    const slug = themeLabel.replace(/[\s·]+/g, "");
    await setMode(page, false);
    await shot(page, `theme-${slug}-亮-grid-主界面`);
    await setMode(page, true);
    await shot(page, `theme-${slug}-暗-grid-主界面`);
    // 霜靛（默认主题）补亮/暗列表形态
    if (themeLabel.includes("霜靛")) {
      await page.locator('button[title="列表视图"]').click();
      await settle();
      await shot(page, `theme-${slug}-暗-list-列表视图`);
      await setMode(page, false);
      await shot(page, `theme-${slug}-亮-list-列表视图`);
      await page.locator('button[title="网格视图"]').click();
      await settle();
    }
  }
  // 巡演结束后回到演示主用形态（霜靛 · 亮）
  await setMode(page, false);
  await check("主题巡演后回到霜靛亮色", !(await isDarkMode(page)));
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
    console.log("主题形态巡演：");
    await themeTour(page);

    console.log(`\n断言：${passCount} 通过 / ${failCount} 失败；截图：${shotIndex} 张 → ${OUT_DIR}`);
    if (failCount > 0) process.exit(1);
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
