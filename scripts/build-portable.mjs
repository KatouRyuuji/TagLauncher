// 便携版打包：把 release 单 exe 打成 zip（解压即用，数据落在 exe 同级 Save/）。
// 用法：node scripts/build-portable.mjs [--target <rust-triple>]
//   无参     → x64：src-tauri/target/release/tag-launcher.exe
//   --target aarch64-pc-windows-msvc → src-tauri/target/<triple>/release/tag-launcher.exe
// 产物：src-tauri/target/[<triple>/]release/bundle/TagLauncher_<version>_<arch>-portable.zip
// 依赖 Windows 自带 PowerShell Compress-Archive，无需新增 npm 依赖。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const idx = argv.indexOf('--target');
  return idx >= 0 ? argv[idx + 1] : '';
}

const target = parseArgs(process.argv.slice(2));
const isArm64 = target === 'aarch64-pc-windows-msvc';
const arch = isArm64 ? 'arm64' : 'x64';

const version = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version;

const releaseDir = target
  ? join(rootDir, 'src-tauri', 'target', target, 'release')
  : join(rootDir, 'src-tauri', 'target', 'release');
const exePath = join(releaseDir, 'tag-launcher.exe');

if (!existsSync(exePath)) {
  console.error(`[ERROR] Executable not found: ${exePath}`);
  console.error('Run "npm run tauri build" first.');
  process.exit(1);
}

const bundleDir = join(releaseDir, 'bundle');
mkdirSync(bundleDir, { recursive: true });
const zipPath = join(bundleDir, `TagLauncher_${version}_${arch}-portable.zip`);

execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -LiteralPath '${exePath}' -DestinationPath '${zipPath}' -Force`,
  ],
  { stdio: 'inherit' },
);

const sizeMB = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`[OK] Portable package: ${zipPath} (${sizeMB} MB)`);
