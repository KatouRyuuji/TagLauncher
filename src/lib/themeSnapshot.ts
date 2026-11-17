// ============================================================================
// lib/themeSnapshot.ts — 主题快照（主窗 → 快速搜索窗）
// ============================================================================
// 快速搜索窗不跑 useTheme（mod 主题未加载时它会回退并写回默认主题，改掉用户设置）。
// 主窗每次 applyTheme 后把根元素上的 CSS 变量与造型属性存进 localStorage；
// 快速窗启动时套用，并监听 storage 事件跟随主窗切换主题（两窗同源，localStorage 共享）。
// ============================================================================

export const THEME_SNAPSHOT_KEY = "taglauncher.theme_snapshot";
const SNAPSHOT_ATTRS = ["data-theme-id", "data-shape", "data-scheme"] as const;

export interface ThemeSnapshot {
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

/** 主窗 :root 不写、但仍要传给快速窗的变量（毛玻璃令牌）。 */
let extraSnapshotVars: Record<string, string> = {};

export function setExtraSnapshotVars(vars: Record<string, string>): void {
  extraSnapshotVars = vars;
}

export function captureThemeSnapshot(root: HTMLElement = document.documentElement): ThemeSnapshot {
  const vars: Record<string, string> = { ...extraSnapshotVars };
  for (let i = 0; i < root.style.length; i += 1) {
    const name = root.style.item(i);
    if (name.startsWith("--")) vars[name] = root.style.getPropertyValue(name);
  }
  const attrs: Record<string, string> = {};
  for (const attr of SNAPSHOT_ATTRS) {
    const value = root.getAttribute(attr);
    if (value !== null) attrs[attr] = value;
  }
  return { vars, attrs };
}

export function saveThemeSnapshot(root: HTMLElement = document.documentElement): void {
  try {
    localStorage.setItem(THEME_SNAPSHOT_KEY, JSON.stringify(captureThemeSnapshot(root)));
  } catch {
    // 隐私模式或配额不足：快速窗退回默认样式
  }
}

export function parseThemeSnapshot(raw: string | null): ThemeSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemeSnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    const pick = (obj: unknown, keep: (k: string) => boolean) =>
      Object.fromEntries(
        Object.entries(obj && typeof obj === "object" ? obj : {}).filter(
          ([k, v]) => typeof v === "string" && keep(k),
        ),
      ) as Record<string, string>;
    return {
      vars: pick(parsed.vars, (k) => k.startsWith("--")),
      attrs: pick(parsed.attrs, (k) => (SNAPSHOT_ATTRS as readonly string[]).includes(k)),
    };
  } catch {
    return null;
  }
}

/** 套用快照：先清掉旧变量，避免切到变量更少的主题时残留 */
export function applyThemeSnapshot(snapshot: ThemeSnapshot, root: HTMLElement = document.documentElement): void {
  for (let i = root.style.length - 1; i >= 0; i -= 1) {
    const name = root.style.item(i);
    if (name.startsWith("--")) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(snapshot.vars)) root.style.setProperty(name, value);
  for (const attr of SNAPSHOT_ATTRS) {
    const value = snapshot.attrs[attr];
    if (value === undefined) root.removeAttribute(attr);
    else root.setAttribute(attr, value);
  }
}
