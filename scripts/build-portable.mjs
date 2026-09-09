// 便携版打包：把 release 单 exe 打成 zip（解压即用；数据落在用户数据目录
// %LOCALAPPDATA%\TagLauncher\Save\，与解压位置无关）。
// zip 内固定顶层目录 TagLauncher/（不带版本号）：解压覆盖到同一位置时 exe 被
// 替换而 exe 同级的 Plugins_Theme/、Plugins_Mods/、synonyms.json、datapath.json
// （数据目录重定向指针）得以保留。
// 用法：node scripts/build-portable.mjs [--target <rust-triple>]
//   无参     → x64：src-tauri/target/release/tag-launcher.exe
//   --target aarch64-pc-windows-msvc → src-tauri/target/<triple>/release/tag-launcher.exe
// 产物：src-tauri/target/[<triple>/]release/bundle/TagLauncher_<version>_<arch>-portable.zip
// 依赖 Windows 自带 PowerShell Compress-Archive，无需新增 npm 依赖。

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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

// 暂存为 TagLauncher/tag-launcher.exe 再压缩，使 zip 内带固定顶层目录
const stagingDir = join(releaseDir, '.portable-staging');
const stagedRoot = join(stagingDir, 'TagLauncher');
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagedRoot, { recursive: true });
copyFileSync(exePath, join(stagedRoot, 'tag-launcher.exe'));

try {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${stagedRoot}' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}

const sizeMB = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`[OK] Portable package: ${zipPath} (${sizeMB} MB)`);
