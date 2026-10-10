// ============================================================================
// lib/cabinetBrowse.ts — 关联文件夹的文件柜：按目录逐层浏览
// ============================================================================
// 关联柜的成员是关联文件夹下全部层级的对象；目录浏览只显示「父目录 = 当前目录」
// 的那一层。路径比较统一为反斜杠、去尾分隔符、大小写不敏感（与后端 path_under 一致）。
// ============================================================================

/** 统一分隔符并去掉末尾分隔符（`D:\` 归一为 `D:`） */
export function normalizeDir(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "");
}

function dirKey(path: string): string {
  return normalizeDir(path).toLowerCase();
}

/** 路径的父目录；没有分隔符时返回空串 */
export function parentDir(path: string): string {
  const normalized = normalizeDir(path);
  const index = normalized.lastIndexOf("\\");
  return index < 0 ? "" : normalized.slice(0, index);
}

/** path 是否位于 root 之下（不含 root 本身） */
export function isUnderDir(path: string, root: string): boolean {
  return dirKey(path).startsWith(`${dirKey(root)}\\`);
}

/** 当前浏览目录：cabinetDir 不在关联文件夹之下（如已改绑）时回到关联文件夹本身 */
export function currentBrowseDir(root: string, cabinetDir: string | null): string {
  return cabinetDir !== null && isUnderDir(cabinetDir, root) ? normalizeDir(cabinetDir) : normalizeDir(root);
}

/** 只保留直接位于 dir 下一层的对象 */
export function itemsInDir<T extends { path: string }>(items: T[], dir: string): T[] {
  const key = dirKey(dir);
  return items.filter((item) => dirKey(parentDir(item.path)) === key);
}

/** 上一级目录；已在关联文件夹本身时返回 undefined，回到根时返回 null */
export function parentBrowseDir(root: string, cabinetDir: string | null): string | null | undefined {
  const dir = currentBrowseDir(root, cabinetDir);
  if (dirKey(dir) === dirKey(root)) return undefined;
  const parent = parentDir(dir);
  return dirKey(parent) === dirKey(root) ? null : parent;
}

export interface BrowseCrumb {
  label: string;
  /** 点击后要设置的 cabinetDir；null 为关联文件夹本身 */
  dir: string | null;
}

/** 面包屑：首段为文件柜名（关联文件夹本身），其后为相对路径的每一级 */
export function browseCrumbs(rootLabel: string, root: string, cabinetDir: string | null): BrowseCrumb[] {
  const base = normalizeDir(root);
  const dir = currentBrowseDir(root, cabinetDir);
  const crumbs: BrowseCrumb[] = [{ label: rootLabel, dir: null }];
  if (dir.length <= base.length) return crumbs;
  let path = base;
  for (const segment of dir.slice(base.length + 1).split("\\")) {
    path = `${path}\\${segment}`;
    crumbs.push({ label: segment, dir: path });
  }
  return crumbs;
}
