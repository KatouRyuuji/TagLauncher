import type { Item } from "../types";

/** 批量重命名规则。规则作用于主文件名；勾选 includeExtension 时作用于含扩展名的完整名称。文件夹始终作用于完整名称。 */
export type BatchRenameRule =
  | {
      kind: "replace";
      find: string;
      replace: string;
      /** 按正则匹配，替换文本支持 $1 等分组引用。 */
      regex: boolean;
      caseSensitive: boolean;
      includeExtension: boolean;
    }
  | {
      kind: "template";
      /** `{name}` 为原主文件名，`{n}` 为序号。 */
      template: string;
      start: number;
      /** 序号补零后的最少位数，0 表示不补零。 */
      pad: number;
      includeExtension: boolean;
    };

export type BatchRenameStatus = "rename" | "unchanged" | "missing" | "duplicate";

export interface BatchRenameRow {
  id: number;
  oldName: string;
  newName: string;
  status: BatchRenameStatus;
}

export interface BatchRenamePlan {
  rows: BatchRenameRow[];
  /** 规则本身有误（如正则无法解析）时的提示；此时所有行保持原名。 */
  error: string | null;
}

type RenameSource = Pick<Item, "id" | "name" | "path" | "type" | "is_missing">;

/** 拆成主文件名与扩展名（含点）；文件夹与没有扩展名的文件扩展名为空。 */
export function splitName(name: string, isFolder: boolean): [string, string] {
  const dot = name.lastIndexOf(".");
  if (isFolder || dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

function parentKey(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(0, Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")) + 1).toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按规则计算每个对象的新名称与状态（输入顺序即序号顺序）。失效对象标为 missing 且不占序号；
 * 同一目录下新名称相同（不区分大小写）的对象全部标为 duplicate。非法名称与目标已存在由后端预检判断。
 */
export function planBatchRename(items: RenameSource[], rule: BatchRenameRule): BatchRenamePlan {
  let pattern: RegExp | null = null;
  if (rule.kind === "replace" && rule.find !== "") {
    try {
      pattern = new RegExp(rule.regex ? rule.find : escapeRegExp(rule.find), rule.caseSensitive ? "g" : "gi");
    } catch (e) {
      const rows = items.map((item) => ({
        id: item.id,
        oldName: item.name,
        newName: item.name,
        status: (item.is_missing ? "missing" : "unchanged") as BatchRenameStatus,
      }));
      return { rows, error: `正则表达式有误：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  let sequence = 0;
  const rows: BatchRenameRow[] = items.map((item) => {
    if (item.is_missing) return { id: item.id, oldName: item.name, newName: item.name, status: "missing" };
    const isFolder = item.type === "folder";
    const [stem, ext] = splitName(item.name, isFolder);
    const target = rule.includeExtension ? item.name : stem;
    const kept = rule.includeExtension ? "" : ext;
    let renamed: string;
    if (rule.kind === "replace") {
      if (!pattern) {
        renamed = target;
      } else if (rule.regex) {
        renamed = target.replace(pattern, rule.replace);
      } else {
        // 普通替换：每次匹配都换成同一文本，避免 $1 被当成分组引用
        const replacement = rule.replace;
        renamed = target.replace(pattern, () => replacement);
      }
    } else {
      const n = String(rule.start + sequence).padStart(rule.pad, "0");
      renamed = rule.template.replace(/\{name\}|\{n\}/g, (token) => (token === "{n}" ? n : stem));
    }
    sequence += 1;
    const newName = renamed + kept;
    return { id: item.id, oldName: item.name, newName, status: newName === item.name ? "unchanged" : "rename" };
  });

  const keys = rows.map((row, i) => parentKey(items[i].path) + row.newName.toLowerCase());
  const counts = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.status === "rename") counts.set(keys[i], (counts.get(keys[i]) ?? 0) + 1);
  });
  rows.forEach((row, i) => {
    if (row.status === "rename" && (counts.get(keys[i]) ?? 0) > 1) row.status = "duplicate";
  });
  return { rows, error: null };
}
