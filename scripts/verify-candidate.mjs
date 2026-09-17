#!/usr/bin/env node
// ============================================================================
// scripts/verify-candidate.mjs — 候选提交复验入口（隔离目录 + 证据清单）
// ----------------------------------------------------------------------------
// 默认跑 npm run test:all；可选 --shots / --native。
// 证据写到 .tmp-test/evidence/<utc>/manifest.json，不写真实用户数据目录。
// 原生/E2E 子进程才会把 TEMP / LOCALAPPDATA / WebView2 指到沙箱。
// ============================================================================

import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IS_WIN = process.platform === "win32";
const args = new Set(process.argv.slice(2));
const withShots = args.has("--shots");
const withNative = args.has("--native");
const frontendOnly = args.has("--frontend-only");

function sh(cmd, cmdArgs, opts = {}) {
  const start = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? ROOT,
    shell: IS_WIN,
    encoding: "utf-8",
    timeout: opts.timeout ?? 600_000,
    env: opts.env ?? process.env,
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    durationMs: Date.now() - start,
    error: r.error ? String(r.error) : "",
  };
}

function capture(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseTestSummary(stdout) {
  const rust = [];
  const re = /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;/g;
  let match;
  while ((match = re.exec(stdout))) {
    rust.push({ passed: Number(match[1]), failed: Number(match[2]) });
  }
  const frontend = /② 前端逻辑测试[^\n]*\s+(\d+)\/(\d+)/.exec(stdout);
  const vitest = /③ vitest[^\n]*\s+(\d+)\/(\d+)/.exec(stdout);
  return {
    rustBins: rust,
    rustPassed: rust.reduce((n, row) => n + row.passed, 0),
    rustFailed: rust.reduce((n, row) => n + row.failed, 0),
    frontend: frontend ? { passed: Number(frontend[1]), total: Number(frontend[2]) } : null,
    vitest: vitest ? { passed: Number(vitest[1]), total: Number(vitest[2]) } : null,
  };
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(ROOT, ".tmp-test", "evidence", stamp);
mkdirSync(evidenceDir, { recursive: true });

const commit = capture("git", ["rev-parse", "HEAD"]);
const dirty = capture("git", ["status", "--porcelain"]);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const debugExe = join(ROOT, "src-tauri", "target", "debug", "tag-launcher.exe");
const releaseExe = join(ROOT, "src-tauri", "target", "release", "tag-launcher.exe");

const steps = [];
function runStep(id, cmd, cmdArgs, extra = {}) {
  console.log(`\n=== ${id} ===`);
  const result = sh(cmd, cmdArgs, extra);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const ok = result.status === 0 && !result.error;
  steps.push({
    id,
    command: [cmd, ...cmdArgs].join(" "),
    status: result.status,
    durationMs: result.durationMs,
    ok,
    error: result.error || undefined,
    summary: parseTestSummary(result.stdout + result.stderr),
  });
  writeFileSync(join(evidenceDir, `${id}.log`), `${result.stdout}\n${result.stderr}`, "utf-8");
  if (!ok) {
    console.error(`\n${id} 失败（exit ${result.status}）`);
  }
  return ok;
}

const testArgs = frontendOnly ? ["--frontend-only"] : [];
let ok = runStep("test-all", "node", [join(ROOT, "scripts", "run-tests.mjs"), ...testArgs]);

if (ok && withShots) {
  ok = runStep("demo-shots", "node", [join(ROOT, "scripts", "demo-screenshots.mjs")], { timeout: 900_000 }) && ok;
}

if (withNative) {
  const isolated = {
    ...process.env,
    TEMP: join(evidenceDir, "tmp"),
    TMP: join(evidenceDir, "tmp"),
    LOCALAPPDATA: join(evidenceDir, "LocalAppData"),
    WEBVIEW2_USER_DATA_FOLDER: join(evidenceDir, "WebView2"),
  };
  mkdirSync(isolated.TEMP, { recursive: true });
  const nativeOk = runStep(
    "native-smoke",
    "python",
    [
      join(ROOT, "scripts", "native-webview-smoke.py"),
      "--exe",
      existsSync(debugExe) ? debugExe : releaseExe,
      "--out",
      join(evidenceDir, "native-result.json"),
    ],
    { env: isolated, timeout: 180_000 },
  );
  ok = nativeOk && ok;
}

const manifest = {
  recordedAt: new Date().toISOString(),
  commit,
  dirty: Boolean(dirty),
  dirtyFiles: dirty ? dirty.split(/\r?\n/).filter(Boolean) : [],
  appVersion: pkg.version,
  schemaLatest: 14,
  platform: process.platform,
  arch: process.arch,
  tools: {
    node: process.version,
    npm: capture(IS_WIN ? "npm.cmd" : "npm", ["--version"]),
    rustc: capture("rustc", ["--version"]),
    cargo: capture("cargo", ["--version"]),
    python: capture("python", ["--version"]),
  },
  binaries: {
    debug: existsSync(debugExe) ? { path: debugExe, sha256: sha256File(debugExe) } : null,
    release: existsSync(releaseExe) ? { path: releaseExe, sha256: sha256File(releaseExe) } : null,
  },
  flags: { frontendOnly, withShots, withNative },
  isolation: {
    evidenceDir,
    notes: "test:all 不改 LOCALAPPDATA，避免打乱 cargo/npm 缓存。--native 才注入沙箱环境。",
  },
  steps,
  ok,
};

writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
console.log(`\n证据：${join(evidenceDir, "manifest.json")}`);
console.log(ok ? "候选复验通过。" : "候选复验失败。");
process.exit(ok ? 0 : 1);
