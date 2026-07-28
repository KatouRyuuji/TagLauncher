#!/usr/bin/env node
// ============================================================================
// scripts/run-tests.mjs — 一键测试运行器（纯 node，无第三方依赖）
// ============================================================================
// 依次执行并汇总：
//   ① npx tsc --noEmit              前端类型检查
//   ② esbuild 打包 + node 执行       src/**/*.design.test.ts 纯逻辑测试
//   ③ vitest run                    src/**/*.spec.ts 交互/组件测试
//   ④ cargo test --lib              后端单元测试（cd src-tauri）
//   ⑤ cargo test                    后端集成测试（src-tauri/tests/ 不存在时自动跳过，不算失败）
// 任一步骤（跳过的除外）失败则整体以退出码 1 结束；最后打印汇总表格。
// ============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP_DIR = join(ROOT, ".tmp-test");
const IS_WIN = process.platform === "win32";

const BIN_TSC = join(ROOT, "node_modules", ".bin", IS_WIN ? "tsc.cmd" : "tsc");
const BIN_ESBUILD = join(ROOT, "node_modules", ".bin", IS_WIN ? "esbuild.cmd" : "esbuild");
const BIN_NPX = IS_WIN ? "npx.cmd" : "npx";

/** @typedef {{ label: string; passed: number; total: number; durationMs: number; status: "pass" | "fail" | "skip" }} StepResult */
/** @type {StepResult[]} */
const results = [];

function sh(cmd, args, opts = {}) {
  const start = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    shell: true,
    encoding: "utf-8",
    timeout: opts.timeout,
    ...opts,
  });
  return { ...r, durationMs: Date.now() - start };
}

function fmtDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// 粗略按东亚宽字符计宽度 2，便于中文标签对齐成表格
function visualWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    w += isWide ? 2 : 1;
  }
  return w;
}

function padVisual(str, width) {
  return str + " ".repeat(Math.max(0, width - visualWidth(str)));
}

// ── ① tsc --noEmit ──────────────────────────────────────────────────────

function stepTsc() {
  console.log("\n=== [1/5] 前端类型检查 (tsc --noEmit) ===");
  const r = sh(BIN_TSC, ["--noEmit"]);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  const ok = r.status === 0;
  results.push({ label: "① tsc 类型检查", passed: ok ? 1 : 0, total: 1, durationMs: r.durationMs, status: ok ? "pass" : "fail" });
}

// ── ② 前端逻辑测试 ───────────────────────────────────────────────────────

function findTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findTestFiles(full));
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const TESTRESULT_RE = /\[TESTRESULT\]\s+(\S+)\s+passed=(\d+)\s+total=(\d+)/;

function stepFrontendTests() {
  console.log("\n=== [2/5] 前端逻辑测试 (esbuild + node) ===");
  const files = findTestFiles(join(ROOT, "src")).sort();

  if (files.length === 0) {
    results.push({ label: "② 前端逻辑测试", passed: 0, total: 0, durationMs: 0, status: "skip" });
    return;
  }

  mkdirSync(TMP_DIR, { recursive: true });

  let filesOk = 0;
  let casesPassed = 0;
  let casesTotal = 0;
  const start = Date.now();

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const name = rel.split("/").pop().replace(/\.test\.ts$/, "");
    const outfile = join(TMP_DIR, `${name}.test.mjs`);

    const bundle = sh(BIN_ESBUILD, [file, "--bundle", "--platform=node", "--format=esm", `--outfile=${outfile}`]);
    if (bundle.status !== 0) {
      console.error(`[FAIL] ${rel}（打包失败）`);
      console.error(bundle.stderr || bundle.stdout);
      casesTotal += 1;
      continue;
    }

    const exec = sh("node", [outfile], { timeout: 30_000 });
    process.stdout.write(exec.stdout || "");
    if (exec.stderr) process.stderr.write(exec.stderr);

    const timedOut = exec.error && exec.error.code === "ETIMEDOUT";
    const match = TESTRESULT_RE.exec(exec.stdout || "");

    if (timedOut) {
      console.error(`[FAIL] ${rel}（执行超时 >30s，疑似死循环回归）`);
      casesTotal += 1;
      continue;
    }

    if (exec.status === 0) filesOk += 1;

    if (match) {
      casesPassed += Number(match[2]);
      casesTotal += Number(match[3]);
    } else {
      // 未使用 __testutil 的测试文件按文件粒度计入 1 个用例（目前所有文件均已采用 __testutil 或顶层 assert 脚本）
      casesTotal += 1;
      if (exec.status === 0) casesPassed += 1;
      else console.error(`[FAIL] ${rel}（退出码 ${exec.status}）`);
    }
  }

  const durationMs = Date.now() - start;
  results.push({
    label: `② 前端逻辑测试（${files.length} 文件）`,
    passed: casesPassed,
    total: casesTotal,
    durationMs,
    status: filesOk === files.length ? "pass" : "fail",
  });
}

// ── ③ vitest 前端交互/组件测试 ───────────────────────────────────────────

function stepVitest() {
  console.log("\n=== [3/5] vitest 前端交互测试 ===");
  const r = sh(BIN_NPX, ["vitest", "run"], { timeout: 120_000 });
  process.stdout.write(r.stdout || "");
  if (r.stderr) process.stderr.write(r.stderr);
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  const ok = !timedOut && r.status === 0;
  // vitest 运行报告末尾含 "Test Files  N passed (N)" / "Tests  M passed (M)"
  const filesMatch = /Test Files\s+(\d+) passed \(?(\d+)\)?/.exec(r.stdout || "");
  const testsMatch = /Tests\s+(\d+) passed \(?(\d+)\)?/.exec(r.stdout || "");
  const passed = testsMatch ? Number(testsMatch[1]) : (ok ? 1 : 0);
  const total = testsMatch ? Number(testsMatch[2]) : 1;
  results.push({
    label: `③ vitest 交互测试（${filesMatch ? filesMatch[2] : "?"} 文件）`,
    passed,
    total,
    durationMs: r.durationMs,
    status: ok ? "pass" : "fail",
  });
}

// ── ④⑤ 后端 cargo test ───────────────────────────────────────────────────

function sumCargoResults(output) {
  const re = /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;/g;
  let passed = 0;
  let failed = 0;
  let m;
  while ((m = re.exec(output))) {
    passed += Number(m[1]);
    failed += Number(m[2]);
  }
  return { passed, failed };
}

function stepCargo(label, args) {
  const r = sh("cargo", args, { cwd: join(ROOT, "src-tauri"), timeout: 300_000 });
  const output = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(output);
  const { passed, failed } = sumCargoResults(output);
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  const ok = !timedOut && r.status === 0 && failed === 0;
  results.push({ label, passed, total: passed + failed, durationMs: r.durationMs, status: ok ? "pass" : "fail" });
}

function stepCargoLib() {
  console.log("\n=== [4/5] 后端单元测试 (cargo test --lib) ===");
  stepCargo("④ cargo test --lib", ["test", "--lib"]);
}

function stepCargoIntegration() {
  console.log("\n=== [5/5] 后端集成测试 (cargo test) ===");
  const testsDir = join(ROOT, "src-tauri", "tests");
  const hasIntegrationTests = existsSync(testsDir) && readdirSync(testsDir).some((f) => f.endsWith(".rs"));

  if (!hasIntegrationTests) {
    console.log("跳过：src-tauri/tests/ 尚不存在或没有 .rs 文件");
    results.push({ label: "⑤ cargo test（集成）", passed: 0, total: 0, durationMs: 0, status: "skip" });
    return;
  }

  stepCargo("⑤ cargo test（集成）", ["test"]);
}

// ── 执行 + 汇总 ───────────────────────────────────────────────────────────
// --frontend-only：仅跑前端逻辑测试 + vitest（对应 npm run test），不做类型检查/后端测试；
// 不带参数：完整五步（对应 npm run test:all）。

const frontendOnly = process.argv.includes("--frontend-only");

if (frontendOnly) {
  stepFrontendTests();
  stepVitest();
} else {
  stepTsc();
  stepFrontendTests();
  stepVitest();
  stepCargoLib();
  stepCargoIntegration();
}

console.log("\n" + "=".repeat(60));
console.log("汇总报告");
console.log("=".repeat(60));

const header = ["模块", "通过/总数", "耗时", "状态"];
const rows = results.map((r) => [
  r.label,
  r.status === "skip" ? "—" : `${r.passed}/${r.total}`,
  fmtDuration(r.durationMs),
  r.status === "pass" ? "✓ 通过" : r.status === "skip" ? "- 跳过" : "✗ 失败",
]);

const widths = header.map((h, i) => Math.max(visualWidth(h), ...rows.map((row) => visualWidth(row[i]))));

console.log(header.map((h, i) => padVisual(h, widths[i])).join(" | "));
console.log(widths.map((w) => "-".repeat(w + 2)).join("|"));
for (const row of rows) {
  console.log(row.map((cell, i) => padVisual(cell, widths[i])).join(" | "));
}

const anyFailed = results.some((r) => r.status === "fail");
console.log("\n" + (anyFailed ? "存在失败步骤。" : "全部通过。"));
process.exit(anyFailed ? 1 : 0);
