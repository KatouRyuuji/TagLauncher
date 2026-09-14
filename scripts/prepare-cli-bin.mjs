// CLI 二进制准备：构建 tl（TagLauncher 命令行）并以 Tauri sidecar 命名规范
// 复制到 src-tauri/bin/tl-<rust-triple>.exe，供 tauri build 的 externalBin 打进
// 安装包（落在主程序同级目录，用户安装后即可在终端直接使用 tl / tl mcp / tl tui）。
// 用法：node scripts/prepare-cli-bin.mjs [--target <rust-triple>]
//   无参     → x64（宿主）：src-tauri/target/release/tl.exe
//   --target aarch64-pc-windows-msvc → 交叉编译 ARM64

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(rootDir, 'src-tauri');

function parseArgs(argv) {
  const idx = argv.indexOf('--target');
  return idx >= 0 ? argv[idx + 1] : '';
}

const target = parseArgs(process.argv.slice(2));
const triple = target || 'x86_64-pc-windows-msvc';

const releaseDir = target
  ? join(tauriDir, 'target', target, 'release')
  : join(tauriDir, 'target', 'release');
const builtExe = join(releaseDir, 'tl.exe');

const sidecarDir = join(tauriDir, 'bin');
mkdirSync(sidecarDir, { recursive: true });
const sidecarPath = join(sidecarDir, `tl-${triple}.exe`);

// 鸡生蛋问题：tauri-build 在编译主包（含 --bin tl 自身）时校验 externalBin 文件
// 已存在，而首次构建时 sidecar 尚未生成。缺位时先放空占位文件通过存在性校验，
// tl 构建完成后用真实产物覆盖；tauri build 只在 tl 成功后才会执行，
// 占位文件不可能进入安装包。
if (!existsSync(sidecarPath)) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(sidecarPath, '');
  console.log(`[prepare-cli] Placeholder sidecar created: ${sidecarPath}`);
}

const cargoArgs = ['build', '--release', '--manifest-path', join(tauriDir, 'Cargo.toml'), '--bin', 'tl'];
if (target) cargoArgs.push('--target', target);
console.log(`[prepare-cli] cargo ${cargoArgs.join(' ')}`);
execFileSync('cargo', cargoArgs, { stdio: 'inherit' });

if (!existsSync(builtExe)) {
  console.error(`[ERROR] tl.exe not found after build: ${builtExe}`);
  process.exit(1);
}

copyFileSync(builtExe, sidecarPath);
console.log(`[OK] Sidecar ready: ${sidecarPath}`);
