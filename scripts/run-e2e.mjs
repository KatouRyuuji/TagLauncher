// E2E 入口：npm run test:e2e[:cli|:ui|:visual|:window|:ci|:safe|:physical] [-- 额外 pytest 参数]
// 顺序固定 CLI → UI → 视觉 → 窗口（conftest 内也会按层排序）。
// 窗口层会接管真实鼠标键盘（physical_input）：默认一律跳过；只有显式 `physical` 层
// 或 TL_E2E_ALLOW_PHYSICAL=1 才会真正跑（先征得使用者同意，开始前 5 秒倒计时）。
// safe 层 = CLI+UI+视觉，且排除 physical_input，开发调试只用它。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [layer = 'all', ...rest] = process.argv.slice(2);
const LAYERS = { cli: ['cli'], ui: ['ui'], visual: ['visual'], window: ['window'], all: ['cli', 'ui', 'visual', 'window'], ci: ['cli', 'ui', 'visual'], safe: ['cli', 'ui', 'visual'], physical: ['window'] };
if (!LAYERS[layer]) {
  console.error(`未知层 ${layer}；可选：${Object.keys(LAYERS).join(' / ')}`);
  process.exit(2);
}
const exe = process.env.TL_E2E_EXE
  ?? ['release', 'debug'].map((p) => join(root, 'src-tauri', 'target', p, 'tag-launcher.exe')).find(existsSync);
if (!exe && layer !== 'cli') {
  console.error('找不到 tag-launcher.exe。先构建内嵌前端的调试包：npx tauri build --debug --no-bundle');
  process.exit(4);
}
const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
if (layer === 'ci') env.CI = env.CI || '1';
if (layer === 'physical') env.TL_E2E_ALLOW_PHYSICAL = '1';
if (layer === 'safe' || layer === 'ci') delete env.TL_E2E_ALLOW_PHYSICAL;
const marks = layer === 'safe' || layer === 'ci' ? ['-m', 'not physical_input'] : [];
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const args = ['-m', 'pytest', '-c', 'e2e/pytest.ini', ...LAYERS[layer].map((l) => `e2e/tests/${l}`), ...marks, ...rest];
console.log(`> ${python} ${args.join(' ')}`);
const r = spawnSync(python, args, { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
