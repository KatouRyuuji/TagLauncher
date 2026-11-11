// 快速窗 / 钉住视图样式约束：只用主题令牌，不写死色值。
// 起因：quick.css 曾引用不存在的 --accent / --bg-app / --bg-selected / --color-danger-ink 回退色，
// 深色主题下快速窗底色仍是浅色（UI 审查 2026-11-11 发现）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_VARIABLE_KEYS } from "../themes/tokens";

const here = join(process.cwd(), "src", "quick");
const css = readFileSync(join(here, "quick.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
/** 本文件自己定义的布局变量（与后端常量对应）和 F03 字号倍率 */
const LOCAL_VARS = new Set(["ui-font-scale", "pin-drawer-width"]);

describe("quick.css 只用主题令牌", () => {
  it("没有写死的颜色（#hex / rgb() / hsl()）", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []).toEqual([]);
  });

  it("引用的每个 CSS 变量都是主题令牌（拼错或不存在的变量会静默落到回退值）", () => {
    const used = [...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
    const known = new Set([...THEME_VARIABLE_KEYS, ...LOCAL_VARS]);
    expect([...new Set(used.filter((v) => !known.has(v)))]).toEqual([]);
  });

  it("快速窗组件不内联写死颜色", () => {
    const offenders = readdirSync(here)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".spec."))
      .flatMap((f) => {
        const src = readFileSync(join(here, f), "utf-8");
        return (src.match(/["'`]#[0-9a-fA-F]{3,8}["'`]|\brgba?\(\d/g) ?? []).map((m) => `${f}: ${m}`);
      });
    expect(offenders).toEqual([]);
  });
});
