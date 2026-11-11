// Win11 一级右键菜单组件（shell-ext/win11-menu）：编译 tl_menu.dll（MSVC）并用 makeappx 打成
// 未签名稀疏包 TagLauncher.ShellMenu.msix，放到 src-tauri/win11-menu/，由 tauri.conf.json 的
// bundle.resources 打进安装包（落在 <程序目录>\win11-menu\）。
//
// tauri-build 在每次编译主包时校验 resources 存在，因此缺位时先放 0 字节占位；--placeholder 只做
// 这一步（CI 单测、e2e 分片、非 Windows）。程序运行时把 0 字节视为「此构建未附带」，设置里不可开启。
// 用法：node scripts/prepare-win11-menu.mjs [--target <rust-triple>] [--placeholder]

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(rootDir, 'src-tauri');
const srcDir = join(rootDir, 'shell-ext', 'win11-menu');
const outDir = join(tauriDir, 'win11-menu');
const FILES = ['tl_menu.dll', 'tl_menu_logo.png', 'TagLauncher.ShellMenu.msix'];

const argv = process.argv.slice(2);
const targetIdx = argv.indexOf('--target');
const target = targetIdx >= 0 ? argv[targetIdx + 1] : '';
const placeholderOnly = argv.includes('--placeholder');

mkdirSync(outDir, { recursive: true });
for (const f of FILES) {
  const p = join(outDir, f);
  if (!existsSync(p)) {
    writeFileSync(p, '');
    console.log(`[win11-menu] Placeholder created: ${p}`);
  }
}
if (placeholderOnly) process.exit(0);
if (process.platform !== 'win32') {
  console.error('[ERROR] prepare-win11-menu 需要在 Windows（MSVC + Windows SDK）上运行；其他平台请用 --placeholder');
  process.exit(1);
}

/** 1.9.1-beta → 1.9.1.0（与 win11_menu.rs package_version 同规则） */
export function packageVersion(v) {
  const parts = v.split(/[-+]/)[0].split('.').map((p) => Math.min(65535, parseInt(p, 10) || 0)).slice(0, 4);
  while (parts.length < 4) parts.push(0);
  return parts.join('.');
}

const cargoToml = readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8');
const version = packageVersion(/^version\s*=\s*"([^"]+)"/m.exec(cargoToml)[1]);
const arch = target ? (target.startsWith('aarch64') ? 'arm64' : 'x64') : (process.arch === 'arm64' ? 'arm64' : 'x64');

// MSVC 环境：vswhere → vcvars（x64 主机交叉编 arm64 用 vcvarsamd64_arm64）
const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
const vsPath = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
const hostArm = process.arch === 'arm64';
const vcvars = join(vsPath, 'VC', 'Auxiliary', 'Build',
  arch === 'arm64' ? (hostArm ? 'vcvarsarm64.bat' : 'vcvarsamd64_arm64.bat') : (hostArm ? 'vcvarsarm64_amd64.bat' : 'vcvars64.bat'));

const work = mkdtempSync(join(tmpdir(), 'tl-win11-menu-'));
try {
  const cl = [
    `"${vcvars}" >nul`,
    `cl /nologo /LD /EHsc /O2 /std:c++17 /utf-8 /DUNICODE /D_UNICODE "${join(srcDir, 'tl_menu.cpp')}" /Fe:"${join(work, 'tl_menu.dll')}" /Fo:"${work}\\\\"`
      + ` /link /DEF:"${join(srcDir, 'tl_menu.def')}" shlwapi.lib shell32.lib ole32.lib oleaut32.lib user32.lib`,
  ].join(' && ');
  console.log(`[win11-menu] build tl_menu.dll (${arch})`);
  execFileSync('cmd.exe', ['/d', '/s', '/c', `"${cl}"`], { stdio: 'inherit', windowsVerbatimArguments: true });

  // 包内容：清单 + 图标（运行时图标从外部位置解析，包里也放一份满足打包校验）
  const pkgDir = join(work, 'pkg');
  mkdirSync(join(pkgDir, 'win11-menu'), { recursive: true });
  const logo = join(tauriDir, 'icons', 'Square44x44Logo.png');
  copyFileSync(logo, join(pkgDir, 'win11-menu', 'tl_menu_logo.png'));
  const manifest = readFileSync(join(srcDir, 'AppxManifest.xml'), 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@ARCH@', arch);
  writeFileSync(join(pkgDir, 'AppxManifest.xml'), manifest);

  const kitsBin = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const sdk = readdirSync(kitsBin).filter((d) => /^10\./.test(d)).sort().reverse()
    .map((d) => join(kitsBin, d, hostArm ? 'arm64' : 'x64', 'makeappx.exe'))
    .find((p) => existsSync(p));
  if (!sdk) throw new Error(`makeappx.exe not found under ${kitsBin}`);
  const msix = join(work, 'TagLauncher.ShellMenu.msix');
  execFileSync(sdk, ['pack', '/o', '/nv', '/d', pkgDir, '/p', msix], { stdio: 'inherit' });

  copyFileSync(join(work, 'tl_menu.dll'), join(outDir, 'tl_menu.dll'));
  copyFileSync(logo, join(outDir, 'tl_menu_logo.png'));
  copyFileSync(msix, join(outDir, 'TagLauncher.ShellMenu.msix'));
  for (const f of FILES) {
    if (!statSync(join(outDir, f)).size) throw new Error(`${f} is empty`);
  }
  console.log(`[OK] Win11 menu ready: ${outDir} (version ${version}, ${arch})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
