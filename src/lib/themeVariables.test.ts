import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, test, run } from "./__testutil";
import { sakuraTheme } from "../themes/sakura";
import { ryuujiThemes } from "../themes/ryuuji";
import { THEME_FAMILIES, presetThemes } from "../themes";
import { shapeLangTokens } from "../themes/shapeLang";

// 规范主题：工厂生成的霜靛·暗，与 tokens.ts 的 DEFAULT_THEME_VARIABLES 同源
const canonicalTheme = ryuujiThemes.find((theme) => theme.id === "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93") ?? ryuujiThemes[0];

function variableKeys(theme: { variables: Record<string, string> }): string[] {
  return Object.keys(theme.variables).sort();
}

function extractRequiredVariables(source: string): string[] {
  const startMarker = "const REQUIRED_VARIABLES: &[&str] = &[";
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error("未找到 REQUIRED_VARIABLES");
  const bodyStart = start + startMarker.length;
  const end = source.indexOf("];", bodyStart);
  if (end < 0) throw new Error("未找到 REQUIRED_VARIABLES 结束标记");
  const names: string[] = [];
  const re = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source.slice(bodyStart, end)))) {
    names.push(match[1]);
  }
  return names;
}

const skyCloud = JSON.parse(
  readFileSync(resolve(process.cwd(), "ExampleTheme/SkyCloudTheme/theme.json"), "utf-8"),
) as { variables: Record<string, string> };

const themeLoaderSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/extensions/theme_loader.rs"),
  "utf-8",
);
const required = extractRequiredVariables(themeLoaderSource);
const indexCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

test("提取逻辑健全：REQUIRED_VARIABLES 数量合理", () => {
  assert.ok(required.length >= 80, `仅提取到 ${required.length} 个必填变量`);
});

test("sakura 与全部工厂主题的 variables 键集合一致", () => {
  const sakuraKeys = variableKeys(sakuraTheme);
  assert.deepEqual(variableKeys(canonicalTheme), sakuraKeys);
  for (const theme of ryuujiThemes) {
    assert.deepEqual(variableKeys(theme), sakuraKeys, `${theme.id} 键集合不一致`);
  }
});

test("预设主题 id 全部为 uuid 形态，且家族注册表覆盖每套预设", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const familyThemeIds = THEME_FAMILIES.flatMap((family) => [family.light, family.dark]);
  for (const theme of [sakuraTheme, ...ryuujiThemes]) {
    assert.ok(UUID_RE.test(theme.id), `${theme.name} 的 id 应为 uuid：${theme.id}`);
    assert.ok(familyThemeIds.includes(theme.id), `家族注册表未覆盖 ${theme.id}`);
  }
});

test("内置主题与 :root 回退把空格预览放在 Mod 模态之下", () => {
  assert.equal(canonicalTheme.variables["z-quick-preview"], "160");
  assert.equal(canonicalTheme.variables["z-command-palette"], "210");
  assert.equal(canonicalTheme.variables["z-shortcuts-help"], "215");
  assert.ok(indexCss.includes("--z-quick-preview: 160;"));
  assert.ok(!indexCss.includes("--z-quick-preview: 205;"));
});

test("示例主题 Sky Cloud 覆盖全部内置键，且预览层级为 160", () => {
  const missing = variableKeys(canonicalTheme).filter((key) => !(key in skyCloud.variables));
  assert.deepEqual(missing, [], `示例主题缺少：${missing.join(", ")}`);
  assert.equal(skyCloud.variables["z-quick-preview"], "160");
});

test("示例主题满足 Rust 必填变量，安装时不会被 theme_loader 拒绝", () => {
  const missing = required.filter((key) => !(key in skyCloud.variables));
  assert.deepEqual(missing, [], `示例主题缺少必填变量：${missing.join(", ")}`);
});

test("Rust 必填变量与内置主题键集合一致（旧主题缺失键由 DEFAULT_THEME_VARIABLES 补齐，仅告警）", () => {
  assert.deepEqual([...required].sort(), variableKeys(canonicalTheme));
});

const SEMANTIC_TO_SYS: Record<string, string> = {
  "bg-base": "bg",
  "text-primary": "text",
  "text-secondary": "text-2",
  "text-tertiary": "text-3",
  "accent-primary": "primary",
  "accent-primary-ink": "primary-ink",
  "accent-signal": "signal",
  "color-danger": "danger",
  "color-danger-ink": "danger-ink",
  "color-warning": "warning",
  "color-warning-ink": "warning-ink",
  "color-success": "success",
  "color-success-ink": "success-ink",
  "text-invert": "on-primary",
};

function ryuujiRoot(): string | null {
  const candidates = [
    process.env.RYUUJI_DESIGN,
    "D:/PersonalProject/RyuujiDesign",
    resolve(process.cwd(), "..", "RyuujiDesign"),
    resolve(process.cwd(), "..", "..", "RyuujiDesign"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((dir) => existsSync(join(dir, "styles/palettes.css"))) ?? null;
}

function cssVar(source: string, name: string): string | null {
  const match = source.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

function normalizeCssValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/0px/g, "0").trim();
}

test("关键语义色与 RyuujiDesign palettes.css 逐值一致（八套含素墨）", () => {
  const root = ryuujiRoot();
  if (!root) {
    const locked = new Set(THEME_FAMILIES.map((family) => family.id === "mono-b" ? "mono" : family.id));
    assert.deepEqual([...locked].sort(), ["a1", "a3", "a6", "mono"]);
    return;
  }
  const source = readFileSync(join(root!, "styles/palettes.css"), "utf-8");
  const lock = JSON.parse(readFileSync(join(root!, "tools/palette-lock.json"), "utf-8")) as {
    named: Record<string, { bgLight: string; bgDark: string }>;
  };
  assert.equal(Object.keys(lock.named).length, 8, "palette-lock 须为八套命名色板");
  const mismatches: string[] = [];
  for (const family of THEME_FAMILIES) {
    const paletteId = family.id === "mono-b" ? "mono" : family.id;
    for (const mode of ["light", "dark"] as const) {
      const block = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
        match[1].includes(`data-lang="${family.lang}"`) &&
        match[1].includes(`data-palette="${paletteId}"`) &&
        match[1].includes(`data-theme="${mode}"`),
      );
      assert.ok(block, `palettes.css 缺少 ${family.name}/${mode}`);
      const sys = Object.fromEntries(
        [...block![2].matchAll(/--sys-([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
      );
      const theme = presetThemes.find((item) => item.id === family[mode]);
      assert.ok(theme, `缺少预设主题 ${family.name}/${mode}`);
      const expectedBg = mode === "light" ? lock.named[paletteId]?.bgLight : lock.named[paletteId]?.bgDark;
      if (expectedBg && theme!.variables["bg-base"] !== expectedBg) {
        mismatches.push(`${family.name}/${mode} bg-base ${theme!.variables["bg-base"]} ≠ lock ${expectedBg}`);
      }
      for (const [appKey, sysKey] of Object.entries(SEMANTIC_TO_SYS)) {
        if (theme!.variables[appKey] !== sys[sysKey]) {
          mismatches.push(`${family.name}/${mode} ${appKey}: ${theme!.variables[appKey]} ≠ --sys-${sysKey} ${sys[sysKey]}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join("\n"));
});

test("结构令牌与 lang/{a,b}.css、tokens.css 对应值一致", () => {
  const root = ryuujiRoot();
  if (!root) {
    assert.equal(shapeLangTokens("a", "light")["radius-sm"], "6px");
    assert.equal(shapeLangTokens("b", "light")["radius-md"], "2px");
    return;
  }
  const langA = readFileSync(join(root!, "styles/lang/a.css"), "utf-8");
  const langB = readFileSync(join(root!, "styles/lang/b.css"), "utf-8");
  const tokens = readFileSync(join(root!, "styles/tokens.css"), "utf-8");
  const a = shapeLangTokens("a", "light");
  const b = shapeLangTokens("b", "light");
  assert.equal(normalizeCssValue(a["radius-sm"]), normalizeCssValue(cssVar(langA, "sys-radius-sm")!));
  assert.equal(normalizeCssValue(a["radius-md"]), normalizeCssValue(cssVar(langA, "sys-radius-md")!));
  assert.equal(normalizeCssValue(a["radius-lg"]), normalizeCssValue(cssVar(langA, "sys-radius-lg")!));
  assert.equal(normalizeCssValue(a["radius-xl"]), normalizeCssValue(cssVar(langA, "sys-radius-xl")!));
  assert.equal(normalizeCssValue(b["radius-sm"]), normalizeCssValue(cssVar(langB, "sys-radius-sm")!));
  assert.equal(normalizeCssValue(b["radius-md"]), normalizeCssValue(cssVar(langB, "sys-radius-md")!));
  assert.equal(a["sidebar-width"], cssVar(tokens, "sys-sidebar-w"));
  assert.ok(a["transition-fast"]!.startsWith(cssVar(tokens, "sys-dur-2")!));
  assert.ok(a["transition-normal"]!.startsWith(cssVar(tokens, "sys-dur-3")!));
  assert.ok(a["transition-slow"]!.startsWith(cssVar(tokens, "sys-dur-5")!));
  assert.equal(normalizeCssValue(a["shadow-well"]), normalizeCssValue(cssVar(langA, "sys-shadow-paper-well")!));
  assert.equal(normalizeCssValue(a["shadow-focus"]), normalizeCssValue(cssVar(tokens, "sys-shadow-focus")!.replace("var(--sys-primary)", "var(--accent-primary)")));
  assert.equal(b["shadow-focus"], "none");
});

test("已交付 CSS 含签名配方与 reduced-motion 静态化", () => {
  assert.ok(indexCss.includes("box-shadow: var(--shadow-card)"));
  assert.ok(indexCss.includes(".action-button-primary"));
  assert.ok(indexCss.includes("background: var(--accent-primary)"));
  assert.ok(indexCss.includes(".row-selected"));
  assert.ok(indexCss.includes("background: var(--row-selected-bg)"));
  assert.ok(indexCss.includes("var(--shadow-focus)"));
  assert.ok(indexCss.includes("0 0 0 4px color-mix(in srgb, var(--accent-primary) 12%, transparent)"));
  assert.ok(indexCss.includes(".tag-pill"));
  assert.ok(indexCss.includes("22%"));
  assert.ok(indexCss.includes("card-hover-lift"));
  assert.ok(indexCss.includes("translateY(-1px)"));
  assert.ok(indexCss.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(indexCss.includes("animation-duration: 0.01ms !important"));
  assert.ok(indexCss.includes(".settings-field:focus-within"));
  assert.equal(canonicalTheme.variables["shadow-focus"], "0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent)");
});

await run("themeVariables");
