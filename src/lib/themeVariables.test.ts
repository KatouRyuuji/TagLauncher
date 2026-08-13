import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert, test, run } from "./__testutil";
import { darkTheme } from "../themes/dark";
import { lightTheme } from "../themes/light";
import { sakuraTheme } from "../themes/sakura";

const NEW_LAYER_KEYS = ["z-quick-preview", "z-command-palette", "z-shortcuts-help"] as const;

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

test("内置 dark / light / sakura 的 variables 键集合一致", () => {
  const darkKeys = variableKeys(darkTheme);
  assert.deepEqual(variableKeys(lightTheme), darkKeys);
  assert.deepEqual(variableKeys(sakuraTheme), darkKeys);
});

test("内置主题与 :root 回退把空格预览放在 Mod 模态之下", () => {
  assert.equal(darkTheme.variables["z-quick-preview"], "160");
  assert.equal(darkTheme.variables["z-command-palette"], "210");
  assert.equal(darkTheme.variables["z-shortcuts-help"], "215");
  assert.ok(indexCss.includes("--z-quick-preview: 160;"));
  assert.ok(!indexCss.includes("--z-quick-preview: 205;"));
});

test("示例主题 Sky Cloud 覆盖全部内置键，且预览层级为 160", () => {
  const missing = variableKeys(darkTheme).filter((key) => !(key in skyCloud.variables));
  assert.deepEqual(missing, [], `示例主题缺少：${missing.join(", ")}`);
  assert.equal(skyCloud.variables["z-quick-preview"], "160");
});

test("示例主题满足 Rust 必填变量，安装时不会被 theme_loader 拒绝", () => {
  const missing = required.filter((key) => !(key in skyCloud.variables));
  assert.deepEqual(missing, [], `示例主题缺少必填变量：${missing.join(", ")}`);
});

test("新增浮层 z 键不是 Rust 必填，旧自定义主题仍可加载", () => {
  for (const key of NEW_LAYER_KEYS) {
    assert.ok(!required.includes(key), `${key} 不应加入 REQUIRED_VARIABLES`);
    assert.ok(key in darkTheme.variables, `内置主题缺少 ${key}`);
  }
});

await run("themeVariables");
