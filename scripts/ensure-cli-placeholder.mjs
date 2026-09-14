// 确保 externalBin sidecar 占位文件存在。
// tauri-build 在每次编译主包（含 cargo test / tauri dev / cargo build）时校验
// tauri.conf.json 的 bundle.externalBin 文件存在，全新克隆没有该文件会直接编译失败。
// 本脚本只创建空占位；发布流程由 prepare-cli-bin.mjs 用真实 tl.exe 覆盖。
// 用法：node scripts/ensure-cli-placeholder.mjs [--target <rust-triple>]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const idx = argv.indexOf('--target');
  return idx >= 0 ? argv[idx + 1] : '';
}

function hostTriple() {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('host:'));
    if (line) return line.slice(5).trim();
  } catch {
    // rustc 不在 PATH 时回退 x64（本项目的 Windows 开发主架构）
  }
  return 'x86_64-pc-windows-msvc';
}

const triple = parseArgs(process.argv.slice(2)) || hostTriple();
const sidecarDir = join(rootDir, 'src-tauri', 'bin');
const sidecarPath = join(sidecarDir, `tl-${triple}.exe`);

if (existsSync(sidecarPath)) {
  console.log(`[OK] Sidecar exists: ${sidecarPath}`);
} else {
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(sidecarPath, '');
  console.log(`[OK] Placeholder sidecar created: ${sidecarPath} (real binary is produced by prepare-cli-bin.mjs at pack time)`);
}
