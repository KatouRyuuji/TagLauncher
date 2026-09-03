import { assert, test, run } from "./__testutil";

// colorMode 依赖 localStorage 与 matchMedia（仅在函数体内求值），node 环境下以最小桩替代
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

let systemDark = true;
const mediaListeners = new Set<() => void>();
(globalThis as Record<string, unknown>).window = {
  matchMedia: (query: string) => ({
    matches: systemDark && query.includes("dark"),
    addEventListener: (_event: string, handler: () => void) => mediaListeners.add(handler),
    removeEventListener: (_event: string, handler: () => void) => mediaListeners.delete(handler),
  }),
};

import {
  COLOR_MODE_KEY,
  getColorMode,
  setColorMode,
  resolveSystemMode,
  resolveColorMode,
  onSystemColorModeChange,
} from "./colorMode";

test("未设置偏好时默认为跟随系统", () => {
  assert.equal(getColorMode(), "system");
});

test("非法持久化值回退为跟随系统", () => {
  store.set(COLOR_MODE_KEY, "neon");
  assert.equal(getColorMode(), "system");
});

test("setColorMode 持久化三种合法值", () => {
  for (const mode of ["light", "dark", "system"] as const) {
    setColorMode(mode);
    assert.equal(store.get(COLOR_MODE_KEY), mode);
    assert.equal(getColorMode(), mode);
  }
});

test("resolveSystemMode 跟随 matchMedia", () => {
  systemDark = true;
  assert.equal(resolveSystemMode(), "dark");
  systemDark = false;
  assert.equal(resolveSystemMode(), "light");
});

test("resolveColorMode：system 走系统求值，显式模式原样返回", () => {
  systemDark = true;
  assert.equal(resolveColorMode("system"), "dark");
  assert.equal(resolveColorMode("light"), "light");
  assert.equal(resolveColorMode("dark"), "dark");
});

test("onSystemColorModeChange 回调收到解析后模式，解绑后不再触发", () => {
  const seen: string[] = [];
  const unbind = onSystemColorModeChange((mode) => seen.push(mode));
  for (const handler of [...mediaListeners]) handler();
  unbind();
  for (const handler of [...mediaListeners]) handler();
  assert.deepEqual(seen, ["dark"]);
});

await run("colorMode");
