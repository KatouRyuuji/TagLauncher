import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert, test, run } from "./__testutil";
import { sakuraTheme } from "../themes/sakura";
import { ryuujiThemes } from "../themes/ryuuji";
import { THEME_FAMILIES, presetThemes } from "../themes";
import { DEFAULT_THEME_VARIABLES } from "../themes/tokens";
import { shapeLangTokens } from "../themes/shapeLang";

const canonicalTheme = ryuujiThemes.find((theme) => theme.id === "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93") ?? ryuujiThemes[0];
const themeLoaderSource = readFileSync(resolve(process.cwd(), "src-tauri/src/extensions/theme_loader.rs"), "utf-8");
const skyCloud = JSON.parse(
  readFileSync(resolve(process.cwd(), "ExampleTheme/SkyCloudTheme/theme.json"), "utf-8"),
) as { variables: Record<string, string> };

function variableKeys(theme: { variables: Record<string, string> }): string[] {
  return Object.keys(theme.variables).sort();
}

function extractRequiredVariables(source: string): string[] {
  const marker = "const REQUIRED_VARIABLES: &[&str] = &[";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("未找到 REQUIRED_VARIABLES");
  const end = source.indexOf("];", start + marker.length);
  if (end < 0) throw new Error("未找到 REQUIRED_VARIABLES 结束标记");
  return [...source.slice(start + marker.length, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("预设主题共用完整变量键集并被家族注册表覆盖", () => {
  const expectedKeys = variableKeys(sakuraTheme);
  const registeredIds = THEME_FAMILIES.flatMap((family) => [family.light, family.dark]);
  for (const theme of [sakuraTheme, ...ryuujiThemes]) {
    assert.deepEqual(variableKeys(theme), expectedKeys, theme.name + " 主题变量不完整");
    assert.ok(registeredIds.includes(theme.id), "未注册主题 " + theme.id);
    assert.match(theme.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});

test("内置主题与示例主题覆盖 Rust 必填变量", () => {
  const required = extractRequiredVariables(themeLoaderSource);
  assert.ok(required.length >= 80, "仅提取到 " + required.length + " 个必填变量");
  assert.deepEqual([...required].sort(), variableKeys(canonicalTheme));
  assert.deepEqual(variableKeys(canonicalTheme).filter((key) => !(key in skyCloud.variables)), []);
  assert.equal(canonicalTheme.variables["z-quick-preview"], "160");
});

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function blend(a: number[], b: number[], amount: number): number[] {
  return a.map((channel, i) => channel * amount + b[i] * (1 - amount));
}
function contrast(a: number[], b: number[]): number {
  const luminance = (channels: number[]) => channels.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("主题具有独立纸面，并保持主要文字的可读对比度", () => {
  for (const mode of ["light", "dark"] as const) {
    const surfaces = new Set<string>();
    for (const family of THEME_FAMILIES) {
      const theme = presetThemes.find((candidate) => candidate.id === family[mode]);
      assert.ok(theme);
      const vars = theme!.variables;
      surfaces.add(vars["bg-surface"]);
      for (const key of ["text-primary", "text-secondary", "text-muted"]) {
        assert.ok(contrast(rgb(vars[key]), rgb(vars["bg-surface"])) >= 4.5, `${family.name} ${mode} ${key} 对比度不足`);
      }
    }
    assert.equal(surfaces.size, THEME_FAMILIES.length);
  }
});

test("家族强调色彼此区分并保持低饱和", () => {
  const accents = THEME_FAMILIES.map((family) =>
    presetThemes.find((theme) => theme.id === family.light)?.variables["accent-primary"],
  );
  assert.deepEqual(accents, ["#4f618c", "#6f647a", "#956d77", "#50565c"]);
  assert.equal(new Set(accents).size, THEME_FAMILIES.length);
});

test("官方主题共享圆角、间距、阴影与正文排版", () => {
  const a = shapeLangTokens("a", "light");
  const b = shapeLangTokens("b", "light");
  for (const key of [
    "radius-sm", "radius-md", "radius-lg", "radius-xl", "radius-2xl", "radius-3xl",
    "sidebar-width", "shadow-sm", "shadow-md", "shadow-lg", "shadow-card",
    "font-family-body", "transition-fast", "transition-normal", "transition-slow",
  ]) {
    assert.equal(a[key], b[key], key + " 应在结构映射间保持一致");
  }
  assert.equal(a["sidebar-width"], "240px");
  assert.equal(a["font-family-body"], a["font-family"]);
});

test("所有标签墨字在对应的亮暗底色上达到 4.5:1", () => {
  for (const family of THEME_FAMILIES) {
    for (const mode of ["light", "dark"] as const) {
      const theme = presetThemes.find((candidate) => candidate.id === family[mode])!;
      for (const color of theme.variables["tag-preset-colors"].split(",")) {
        const ink = blend(rgb(color), rgb(theme.variables["text-primary"]), 0.88);
        const fill = blend(rgb(color), rgb(theme.variables["bg-card"]), mode === "dark" ? 0.15 : 0.09);
        const ratio = contrast(ink, fill);
        assert.ok(ratio >= 4.5, `${family.name} ${mode} ${color} 对比度 ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.equal(DEFAULT_THEME_VARIABLES["tag-color-alpha"], "7%");
});

await run("themeVariables");
