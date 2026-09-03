import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert, test, run } from "./__testutil";
import { sakuraTheme } from "../themes/sakura";
import { ryuujiThemes } from "../themes/ryuuji";
import { THEME_FAMILIES } from "../themes";

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

await run("themeVariables");
