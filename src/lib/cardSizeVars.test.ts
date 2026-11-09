// ============================================================================
// lib/cardSizeVars.test.ts — 卡片尺寸变量：少结果网格也须跟随缩放（BUG-12）
// ============================================================================
import { readFileSync } from "node:fs";
import { assert, test, run } from "./__testutil";
import { BASE_CARD_COL_MIN } from "./cardSizeVars";

test("BUG-12 少结果卡片宽度由 --grid-col-min 推导，默认档仍为 300px", () => {
  const css = readFileSync("src/index.css", "utf-8");
  const rule = css.match(/\.item-grid-few-card\s*\{([^}]*)\}/);
  assert.ok(rule, "缺少 .item-grid-few-card 规则");
  const width = rule[1].match(/width:\s*([^;]+);/)?.[1] ?? "";
  assert.ok(width.includes("var(--grid-col-min)"), `宽度未引用 --grid-col-min：${width}`);
  const factor = Number(width.match(/\*\s*([\d.]+)/)?.[1]);
  assert.equal(Math.round(BASE_CARD_COL_MIN * factor), 300);
});

await run("cardSizeVars");
