// CLI 二进制准备：构建 tl（TagLauncher 命令行）并以 Tauri sidecar 命名规范
// 复制到 src-tauri/bin/tl-<rust-triple>.exe，供 tauri build 的 externalBin 打进
// 安装包（落在主程序同级目录，用户安装后即可在终端直接使用 tl / tl mcp / tl tui）。
//
// tauri-build 在每次编译主包（含 cargo test / tauri dev / cargo build，以及 --bin tl
// 自身）时校验 externalBin 文件存在，因此缺位时先放 0 字节占位文件；--placeholder
// 只做这一步（全新克隆、dev.bat、setup.bat、CI 测试使用），不构建 tl。
// 用法：node scripts/prepare-cli-bin.mjs [--target <rust-triple>] [--placeholder]
//   无 --target → 宿主架构（rustc -vV 的 host），产物在 src-tauri/target/release/tl.exe
//   --target aarch64-pc-windows-msvc → 交叉编译 ARM64

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(rootDir, 'src-tauri');

const argv = process.argv.slice(2);
const targetIdx = argv.indexOf('--target');
const target = targetIdx >= 0 ? argv[targetIdx + 1] : '';
const placeholderOnly = argv.includes('--placeholder');

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

const triple = target || hostTriple();
const sidecarDir = join(tauriDir, 'bin');
const sidecarPath = join(sidecarDir, `tl-${triple}.exe`);

mkdirSync(sidecarDir, { recursive: true });
if (!existsSync(sidecarPath)) {
  writeFileSync(sidecarPath, '');
  console.log(`[prepare-cli] Placeholder sidecar created: ${sidecarPath}`);
} else if (placeholderOnly) {
  console.log(`[prepare-cli] Sidecar exists: ${sidecarPath}`);
}
if (placeholderOnly) process.exit(0);

// tauri build 只在 tl 构建成功后才会执行，占位文件不会进入安装包。
const releaseDir = target ? join(tauriDir, 'target', target, 'release') : join(tauriDir, 'target', 'release');
const builtExe = join(releaseDir, 'tl.exe');
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
