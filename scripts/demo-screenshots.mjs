// ============================================================================
// scripts/demo-screenshots.mjs — 全功能 UI 交互测试 + 全形态截图
// ============================================================================
// 启动 demo 模式（浏览器内 mock 后端 + 11 个全覆盖模拟对象，见 src/demo/），
// 用 Playwright 驱动真实 UI 交互，逐特性断言行为正确（check 计数，失败以
// 退出码 1 结束），并在每个形态落截图。
//
// 覆盖：欢迎页 / 网格 / 列表 / 侧栏新建标签·文件柜编辑态 / 添加文件夹入库方式 /
// 关键词（含高亮）·拼音·表达式搜索 / 搜索模式切换 / 类型筛选 / 筛选无结果空态 /
// 标签 DAG 筛选（父并入后代、多选交集）/ 收藏 / 最近使用 / 文件柜 / 排序 /
// 命令面板（打开态·命令过滤·对象搜索）/ 快速预览（图片·音频·视频·文件夹）/
// 右键菜单（单选·多选·添加到文件柜子菜单）/ 标签编辑 / 框选与批量工具条（含下拉菜单）/
// 标签关系编辑 / 标签图谱 / 设置六区块（含主题下拉打开态）/ AI 打标（进行中 + 完成）/
// 快捷键帮助 / F3 / 失效项目复核 / 批量移除确认 / 空库引导 / 首屏骨架屏；
// 主题形态：全部内置配色家族 × 亮/暗 + 霜靛亮/暗列表。
//
// 用法：
//   npm run demo:shots            # 测试 + 截图到 宣传视频/e2e-review/（自动创建，覆盖旧图）
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
const OUT_DIR = path.resolve(argValue("out", "宣传视频/e2e-review"));
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

async function ensureFiltersOpen(page) {
  const bar = page.locator('[data-region="filterbar"]');
  if (await bar.count()) return;
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await settle(250);
}

async function closeSettings(page) {
  await closeOverlays(page);
  await page.getByRole("dialog", { name: "设置工作台" }).waitFor({ state: "detached" });
}

async function goToSettingsSection(page, chipLabel) {
  await page.locator('nav[aria-label="设置区块导航"] button', { hasText: chipLabel }).click();
  await settle(600);
}

async function selectTheme(page, themeLabel) {
  const dialog = page.getByRole("dialog", { name: "设置工作台" });
  await page.locator('nav[aria-label="设置区块导航"]').getByRole("button", { name: "主题外观", exact: true }).click();
  // 主题选择器为自绘 SelectMenu：点开按钮后按选项文本选择
  // （弹层 portal 到 body，不在设置对话框 DOM 内，选项须从 page 范围定位）
  await dialog.locator('button[aria-label="当前主题"]').click();
  await settle(250);
  await page.locator('[role="listbox"] [role="option"]', { hasText: themeLabel }).first().click();
  await settle(600);
}

/** 读取已生效的模式，截图命名与根节点状态保持一致。 */
async function isDarkMode(page) {
  return (await page.locator("html").getAttribute("data-scheme")) === "dark";
}

async function setMode(page, wantDark) {
  if ((await isDarkMode(page)) !== wantDark) {
    await page.locator(`button[aria-label="${wantDark ? "切换到暗色模式" : "切换到亮色模式"}"]`).click();
    await page.waitForFunction((mode) => document.documentElement.dataset.scheme === mode, wantDark ? "dark" : "light");
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
  await check("欢迎页赞赏码可见", page.getByRole("img", { name: "赞赏码" }).isVisible());
  await page.getByRole("button", { name: "开始使用" }).click();
  await settle();

  // 02 网格视图
  await shot(page, "workspace-grid-主界面-网格视图");
  await check("网格视图渲染 11 个对象", (await itemCount(page)) === 11);
  await check("状态栏计数 11 项目", (await statusText(page))?.includes("11 项目"));
  await check("失效对象徽标可见", page.locator("[data-selectable-item-id]").filter({ hasText: "影视收藏" }).getByText("失效", { exact: true }).isVisible());

  // 02b 首页侧栏官方主题色点 + 亮/暗分段（用完后回到霜靛亮，避免污染后续巡演）
  const themeDock = page.locator('[data-region="sidebar-theme"]');
  await check("侧栏主题快捷切换可见", themeDock.isVisible());
  const familyRadios = themeDock.getByRole("radiogroup", { name: "官方主题" }).getByRole("radio");
  await check("官方主题色点为 4 个", (await familyRadios.count()) === 4);
  const themeIdBefore = await page.locator("html").getAttribute("data-theme-id");
  await themeDock.locator('[role="radio"][aria-checked="false"]').first().click();
  await settle(500);
  const themeIdAfterFamily = await page.locator("html").getAttribute("data-theme-id");
  await check("点击色点后 data-theme-id 变化", Boolean(themeIdAfterFamily && themeIdAfterFamily !== themeIdBefore));
  const accentBeforeMode = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim(),
  );
  await themeDock.getByRole("radio", { name: "暗色" }).click();
  await settle(500);
  const accentAfterMode = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim(),
  );
  await check("点击暗色后 data-scheme 为 dark", (await page.locator("html").getAttribute("data-scheme")) === "dark");
  await check("点击暗色后 --accent-primary 变化", accentAfterMode !== accentBeforeMode);
  await themeDock.getByRole("radio", { name: "霜靛" }).click();
  await settle(400);
  await themeDock.getByRole("radio", { name: "亮色" }).click();
  await settle(500);
  await check("恢复霜靛亮色", (await page.locator("html").getAttribute("data-scheme")) === "light");

  // 02c 添加文件夹：拖入目录后弹出入库方式（取消，避免污染后续巡演数据）
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(
      "text/uri-list",
      ["file:///C:/Demo/新项目资料", "file:///C:/Demo/素材库", "file:///C:/Demo/brief.txt"].join("\n"),
    );
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    const target = document.querySelector('[data-region="main"]');
    if (!(target instanceof HTMLElement)) throw new Error("main region missing");
    target.dispatchEvent(event);
  });
  await page.getByRole("dialog", { name: "添加文件夹" }).waitFor();
  await settle(400);
  await shot(page, "folder-import-添加文件夹-入库方式");
  await check("添加文件夹弹窗打开", page.getByRole("dialog", { name: "添加文件夹" }).isVisible());
  await check("入库方式含「只加入文件夹」", page.getByRole("radio", { name: /只加入文件夹/ }).isVisible());
  await page.getByRole("dialog", { name: "添加文件夹" }).getByRole("button", { name: "取消" }).click();
  await page.getByRole("dialog", { name: "添加文件夹" }).waitFor({ state: "detached" });

  // 03 列表视图（全幅表格 + 表头）
  await page.locator('button[title="列表视图"]').click();
  await settle();
  await shot(page, "workspace-list-主界面-列表视图");
  await check("列表视图渲染 11 行", (await itemCount(page)) === 11);
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

  // 03c 侧栏 - 新建标签（打开的编辑态，不保存直接关闭）
  await page.locator('[data-region="sidebar-nav"] button:has-text("新建标签")').click();
  await settle(400);
  await shot(page, "sidebar-tag-new-侧栏-新建标签");
  await check("新建标签弹窗打开", page.getByRole("dialog", { name: "新建标签" }).getByRole("heading", { name: "新建标签" }).isVisible());
  await closeOverlays(page);
  await page.getByRole("dialog", { name: "新建标签" }).waitFor({ state: "detached" });

  // 03d 侧栏 - 新建文件柜（文件柜页签 → 编辑态 → 回到标签页签）
  await page.locator('[data-region="sidebar"] button:has-text("文件柜")').first().click();
  await settle(300);
  await page.locator('[data-region="sidebar-nav"] button:has-text("新建文件柜")').click();
  await settle(400);
  await shot(page, "sidebar-cabinet-new-侧栏-新建文件柜");
  await check("新建文件柜弹窗打开", page.getByRole("dialog", { name: "新建文件柜" }).getByRole("heading", { name: "新建文件柜" }).isVisible());
  await closeOverlays(page);
  await page.getByRole("dialog", { name: "新建文件柜" }).waitFor({ state: "detached" });
  await page.locator('[data-region="sidebar"] button:has-text("标签")').first().click();
  await settle(300);

  // 04 搜索 - 关键词
  const search = page.locator("#workspace-search");
  await search.click();
  await search.fill("晴天");
  await settle(800);
  await shot(page, "search-keyword-搜索-关键词");
  await check("关键词搜索「晴天」命中 1 项", (await itemCount(page)) === 1);
  await check("命中词高亮渲染（mark.search-highlight）", page.locator("mark.search-highlight").first().isVisible());

  // 04b 搜索模式切换（全部 → 仅名称：范围页签是唯一控件，筛选行可见时不再画重复徽标）
  await ensureFiltersOpen(page);
  const searchScopeGroup = page.locator('[role="group"][aria-label="搜索范围"]');
  await searchScopeGroup.locator('button:has-text("名称")').click();
  await settle(600);
  await shot(page, "search-mode-搜索模式切换-仅名称");
  await check("仅名称页签处于按下态", searchScopeGroup.locator('button[aria-pressed="true"]:has-text("名称")').isVisible());
  await check("筛选行可见时不画范围徽标（单控件）", (await page.locator('[data-testid="search-mode-badge"]').count()) === 0);
  await check("仅名称模式「晴天」仍命中 1 项", (await itemCount(page)) === 1);
  await searchScopeGroup.locator('button:has-text("全部")').click();
  await settle(400);
  await check("恢复全部范围页签", searchScopeGroup.locator('button[aria-pressed="true"]:has-text("全部")').isVisible());

  // 05 搜索 - 拼音首字母（zjl → 周杰伦）
  await search.fill("zjl");
  await settle(800);
  await shot(page, "search-pinyin-搜索-拼音首字母");
  await check("拼音首字母「zjl」命中周杰伦", (await itemCount(page)) === 1);

  // 06 搜索 - 表达式（与/排除）
  await search.fill("开发&&自动化");
  await settle(800);
  await shot(page, "search-expression-搜索-表达式");
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
  await check("清空搜索恢复 11 项", (await itemCount(page)) === 11);

  // 08 类型筛选（先展开筛选条 → 图片 = 2）
  await ensureFiltersOpen(page);
  const typeChipImage = page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("图片")');
  await typeChipImage.hover();
  await settle(250);
  await shot(page, "filter-type-open-类型筛选栏");
  await typeChipImage.click();
  await settle(500);
  await shot(page, "filter-type-类型筛选-图片");
  await check("类型筛选「图片」命中 2 项", (await itemCount(page)) === 2);
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("图片")').click();
  await settle(400);
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("视频")').click();
  await settle(500);
  await shot(page, "filter-type-类型筛选-视频");
  await check("类型筛选「视频」命中 1 项", (await itemCount(page)) === 1);
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("视频")').click();
  await settle(400);

  // 08b 筛选无结果空态（类型「图片」∩ 标签「开发」无交集 → 一键清空筛选）
  await page.locator('[role="group"][aria-label="文件类型筛选"] button:has-text("图片")').click();
  await settle(300);
  await sidebarTag(page, "开发");
  await shot(page, "filter-empty-筛选无结果空态");
  await check("筛选无结果空态出现「清空所有筛选」", page.getByRole("button", { name: "清空所有筛选" }).isVisible());
  await page.getByRole("button", { name: "清空所有筛选" }).click();
  await settle(600);
  await check("清空筛选恢复 11 项", (await itemCount(page)) === 11);

  // 09 标签筛选（父标签并入后代对象：娱乐 ⊃ 游戏/音乐/电影 → 4 项）
  await sidebarTag(page, "娱乐");
  await shot(page, "filter-tag-标签筛选-父标签含后代");
  await check("父标签「娱乐」并入后代共 4 项", (await itemCount(page)) === 4);
  const scopeHeader = page.locator('[data-region="scope-header"]');
  await check("范围标题写出「娱乐 · 含下级 · 4 项」", (await scopeHeader.textContent())?.replace(/\s+/g, "").includes("娱乐4项含下级"));
  await sidebarTag(page, "娱乐");
  await check("侧栏「娱乐」未选中时标出含下级", page.locator('[data-region="sidebar-nav"] button:has-text("娱乐")').first().getByText("含下级").isVisible());

  // 10 标签多选交集（开发 ∩ 自动化 = 2）
  await sidebarTag(page, "开发");
  await sidebarTag(page, "自动化");
  await shot(page, "filter-tag-multi-标签多选交集");
  await check("「开发 ∩ 自动化」命中 2 项", (await itemCount(page)) === 2);
  await check("标签芯片之间写「且」", page.locator('[data-region="tagfilterbar"]').getByText("且", { exact: true }).isVisible());
  await check("范围标题写出「开发 且 自动化」", (await scopeHeader.textContent())?.includes("开发 且 自动化"));
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
  await check("最近使用 10 项（失效对象从未启动）", (await itemCount(page)) === 10);
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

  // 15 命令面板（Ctrl+K 打开态 → 命令过滤 → 对象搜索）
  await page.keyboard.press("Control+k");
  await settle();
  await shot(page, "command-palette-open-命令面板-打开态");
  await check("命令面板打开", page.getByRole("dialog", { name: "命令面板" }).isVisible());
  const paletteInput = page.getByRole("textbox", { name: "搜索命令或项目" });
  await paletteInput.fill("设置");
  await settle(500);
  await shot(page, "command-palette-filter-命令面板-命令过滤");
  await check("命令过滤命中「打开设置」", page.getByRole("dialog", { name: "命令面板" }).getByText("打开设置").first().isVisible());
  await paletteInput.fill("");
  await settle(300);
  await paletteInput.fill("vscode");
  await settle(500);
  await shot(page, "command-palette-item-命令面板-对象搜索");
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

  // 18b 快速预览 - 视频（播放器或首帧占位）
  await rightClickItem(page, "星际穿越");
  await clickMenu(page, "快速预览");
  await settle(700);
  await shot(page, "preview-video-快速预览-视频");
  await check("视频预览对话框打开", page.getByRole("dialog", { name: "快速预览" }).getByText("视频", { exact: true }).first().isVisible());
  await check("视频预览有播放器或首帧图",
    (await page.locator('[data-quick-preview] video, [data-quick-preview] img[alt$="首帧"]').count()) > 0);
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

  // 21b 右键菜单 - 添加到文件柜子菜单（悬停展开，两级 Escape 逐级关闭）
  await rightClickItem(page, "原神");
  await page.getByRole("menuitem", { name: "添加到文件柜" }).hover();
  await settle(400);
  await shot(page, "context-menu-cabinet-右键菜单-添加到文件柜");
  await check("文件柜子菜单列出「娱乐休闲」", page.getByRole("menuitem", { name: "娱乐休闲" }).isVisible());
  await closeOverlays(page);
  await closeOverlays(page);
  await clearSelection(page);

  // 21c 右键菜单 - 多选对象（Ctrl 加选后右击选中项，批量语义菜单）
  await itemCard(page, "原神").click({ modifiers: ["Control"] });
  await itemCard(page, "Visual Studio Code").click({ modifiers: ["Control"] });
  await settle(300);
  await rightClickItem(page, "原神");
  await shot(page, "context-menu-multi-右键菜单-多选");
  await check("多选菜单显示「复制 2 条路径」", page.getByText("复制 2 条路径", { exact: true }).isVisible());
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

  // 22b 批量工具条下拉菜单（加入标签）
  await page.getByRole("button", { name: "加入标签" }).click();
  await settle(300);
  await shot(page, "batch-menu-批量工具条-加入标签下拉");
  await check("加入标签下拉菜单展开", (await page.locator('[data-floating-menu] [role="menuitem"]').count()) > 0);
  await page.keyboard.press("Escape");
  await settle(200);
  await check("下拉菜单已收起", (await page.locator('[data-floating-menu]').count()) === 0);
  await clearSelection(page);

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
  await check("标签图谱渲染层级", page.getByText(/第\s*1\s*层/).first().isVisible());
  await closeOverlays(page);

  // 25-30 设置面板各区块
  await openSettings(page);
  await shot(page, "settings-theme-设置-主题外观");
  await check("设置面板打开", page.getByRole("dialog", { name: "设置工作台" }).isVisible());

  // 25b 主题下拉打开态（再点触发按钮收起，避免 Escape 误关设置对话框）
  const themeTrigger = page.getByRole("dialog", { name: "设置工作台" }).locator('button[aria-label="当前主题"]');
  await themeTrigger.click();
  await settle(300);
  await shot(page, "settings-theme-dropdown-设置-主题下拉打开");
  await check("主题下拉列出内置配色家族", (await page.locator('[role="listbox"][aria-label="当前主题"] [role="option"]').count()) >= 4);
  await themeTrigger.click();
  await settle(250);
  await check("主题下拉已收起", (await page.locator('[role="listbox"][aria-label="当前主题"]').count()) === 0);

  await goToSettingsSection(page, "AI");
  await shot(page, "settings-ai-设置-AI自动打标");

  // 26 AI 一键打标（mock 建议 → 真实编排进度：先截进行中，再等完成）
  await page.getByRole("button", { name: "为全部对象打标" }).click();
  await page.getByRole("dialog", { name: "AI 打标进度" }).waitFor();
  await shot(page, "ai-tagging-running-AI打标-进行中");
  await check("AI 打标进行中弹窗出现", page.getByText("正在自动打标…").isVisible());
  await page.getByText("打标完成").waitFor({ timeout: 60_000 });
  await settle(400);
  await shot(page, "ai-tagging-AI批量打标");
  await check("AI 打标完成", page.getByText("打标完成").isVisible());
  await page.getByRole("dialog", { name: "AI 打标进度" }).getByRole("button", { name: "关闭" }).click();
  await settle();

  await goToSettingsSection(page, "数据管理");
  await shot(page, "settings-data-设置-数据管理");
  await goToSettingsSection(page, "云同步");
  await shot(page, "settings-sync-设置-云同步");
  await goToSettingsSection(page, "更新");
  await shot(page, "settings-update-设置-在线更新");
  await goToSettingsSection(page, "扩展");
  await shot(page, "settings-mods-设置-扩展Mod管理");
  await closeSettings(page);

  // 31 快捷键帮助
  await page.keyboard.press("?");
  await settle();
  await shot(page, "shortcuts-help-快捷键帮助");
  await check("快捷键帮助含 F3 条目", page.getByText(/F3/).first().isVisible());
  await closeOverlays(page);

  // 32 失效项目复核（状态栏徽标 → 复核弹窗 → 找回失败 toast）
  await page.getByText("个失效 · 待处理").click();
  await page.getByRole("dialog", { name: "失效项目" }).waitFor();
  await settle(400);
  await shot(page, "missing-review-失效项目复核");
  await check("失效复核弹窗打开", page.getByRole("dialog", { name: "失效项目" }).isVisible());
  await page.getByRole("button", { name: "尝试找回全部失效项" }).click();
  await page.getByText("未能自动找回失效项目").waitFor({ timeout: 10_000 });
  await settle(400);
  await shot(page, "missing-relocate-失效对象找回反馈");
  await closeOverlays(page);
  await page.getByRole("dialog", { name: "失效项目" }).waitFor({ state: "detached" });

  // 33 空库引导：全选 → 批量移除（确认弹窗）→ 空库空态。
  //    demo 后端为页面内存态，随后 reload 即复位为初始演示数据集。
  await page.locator(".toast-enter").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await page.locator('[data-region="main"]').click({ position: { x: 6, y: 300 } });
  await page.keyboard.press("Control+a");
  await settle(300);
  await check("Ctrl+A 全选 11 项", (await page.locator('[data-testid="batch-toolbar"]').textContent())?.includes("11"));
  await page.keyboard.press("Delete");
  await settle(400);
  await shot(page, "remove-confirm-批量移除确认");
  const removeDialog = page.getByRole("dialog", { name: /^移出资料库/ });
  await check("批量移除确认弹窗打开", removeDialog.isVisible());
  await check("仅出库是唯一实心主按钮", removeDialog.locator("button.action-button-primary").allTextContents().then((t) => t.length === 1 && t[0].includes("仅出库")));
  await removeDialog.getByRole("button", { name: "仅出库", exact: true }).click();
  await settle(700);
  await shot(page, "empty-library-空库引导");
  await check("空库引导出现「暂无项目」", page.getByText("暂无项目").isVisible());
  await check("空库侧栏仍列出已有标签", page.locator('[data-region="sidebar"]').getByText("开发", { exact: true }).count().then((n) => n > 0));

  // 34 首屏骨架屏：主题加载门控会消耗 mock IPC 延迟的前段，用 ?demo-latency=4000
  //    留出约 2s 的骨架屏窗口；随后回到默认延迟重新进入，演示数据随之复位
  //    （页面内存态随刷新重建）。提前隐藏欢迎页，避免遮挡骨架屏。
  await page.evaluate(() => localStorage.setItem("taglauncher.hide_welcome_modal", "1"));
  await page.goto(`${BASE}/?demo-latency=4000`, { waitUntil: "domcontentloaded" });
  const skeleton = page.locator('[data-region="workspace-skeleton"]');
  await skeleton.waitFor();
  await shot(page, "workspace-skeleton-首屏骨架屏");
  await check("首屏骨架屏渲染", skeleton.isVisible());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-region="main"] [data-selectable-item-id]').first().waitFor();
  await settle();
  await check("重新进入后演示数据复位为 11 项", (await itemCount(page)) === 11);
}

// ---- 主题形态巡演：全部配色家族 × 亮/暗 网格 + 霜靛亮/暗列表 ----

async function themeTour(page) {
  // 等上一步（失效找回）的 toast 驻留期结束，避免带入主题截图
  await page.locator(".toast-enter").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await settle(500);
  await openSettings(page);
  await page.locator('nav[aria-label="设置区块导航"]').getByRole("button", { name: "主题外观", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置工作台" });
  // 收集「内置主题」分组下全部配色家族名（自绘 SelectMenu 的 option 文本）
  await dialog.locator('button[aria-label="当前主题"]').click();
  await settle(250);
  const themeLabels = await page.locator('[role="listbox"] [role="option"]').evaluateAll(
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
  // 幂等：先清上一轮旧图（同名覆盖之外，序号漂移也不留残留），目录内容恒等于本轮产出
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith(".png")) fs.rmSync(path.join(OUT_DIR, file));
  }
  const server = await ensureServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => { pageErrors.push(err.message); console.warn("  [pageerror]", err.message); });

    console.log("打开 demo 应用…");
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.locator('[data-region="root"]').waitFor();

    console.log("功能特性巡演：");
    await featureTour(page);
    console.log("主题形态巡演：");
    await themeTour(page);
    await check("巡演没有页面运行时错误", pageErrors.length === 0);

    console.log(`\n断言：${passCount} 通过 / ${failCount} 失败；截图：${shotIndex} 张 → ${OUT_DIR}`);
    if (failCount > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
