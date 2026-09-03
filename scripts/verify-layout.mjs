// 验证脚本：新布局在多宽度/暗色/列表视图/弹窗/图谱下的表现
import { chromium } from "playwright";

const BASE = "http://localhost:5199/";
const browser = await chromium.launch();

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const start = page.locator("text=开始使用").first();
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForTimeout(300);
  return page;
}

// 切到内置家族主题并设为暗色（demo 默认 sakura 不在家族内，模式开关不可用）
async function toDarkFamily(page) {
  await page.locator('button[aria-label="设置"]').click();
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="当前主题"]').click();
  await page.waitForTimeout(250);
  await page.locator('[role="option"]', { hasText: "霜靛" }).first().click();
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="关闭设置"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="切换到暗色模式"]').click();
  await page.waitForTimeout(400);
}

// 1. 三宽度网格视图（亮色）
for (const [w, name] of [[785, "785"], [1100, "1100"], [1900, "1900"]]) {
  const page = await newPage(w, 1000);
  await page.screenshot({ path: `scripts/.v-grid-${name}.png` });
  await page.close();
}

// 2. 暗色 + 列表视图（1900 / 981）
for (const [w, name] of [[1900, "1900"], [981, "981"]]) {
  const page = await newPage(w, 1000);
  await toDarkFamily(page);
  await page.locator('button[aria-label="列表视图"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `scripts/.v-list-dark-${name}.png` });

  await page.locator('button[aria-label="排序方式"]').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `scripts/.v-sortmenu-dark-${name}.png` });
  await page.keyboard.press("Escape");
  await page.close();
}

// 3. 标签关系弹窗 + 图谱（暗色 1900）
{
  const page = await newPage(1900, 1000);
  await toDarkFamily(page);
  await page.locator('button[aria-label="管理标签父子关系"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "scripts/.v-relations-dark.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="打开标签关系图"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "scripts/.v-graph-dark.png" });
  await page.close();
}

await browser.close();
console.log("done");
