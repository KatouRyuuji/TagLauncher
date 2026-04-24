/**
 * Mod 权限声明（在 manifest.json 中声明后由运行时强制执行）
 *   "items:read"      — 调用 getItems() / onItemsChanged()
 *   "items:write"     — addItem() / removeItem() / setItemTags() / toggleFavorite()
 *   "tags:read"       — getTags() / onTagsChanged()
 *   "tags:write"      — addTag() / updateTag() / removeTag()
 *   "cabinets:read"   — getCabinets() / onCabinetsChanged()
 *   "cabinets:write"  — addCabinet() / updateCabinet() / removeCabinet() / add/removeItemFromCabinet()
 *   "launch"          — launchItem()
 *   "storage"         — mod 专属 localStorage 空间
 *   "dom"             — 操作 DOM 结构
 *   "theme"           — 读写 CSS 变量（setThemeVariable）
 *
 * 若 permissions 未声明（undefined / 空数组），则不受限制（向后兼容）。
 */
export type ModPermission =
  | "items:read"
  | "items:write"
  | "tags:read"
  | "tags:write"
  | "cabinets:read"
  | "cabinets:write"
  | "launch"
  | "storage"
  | "dom"
  | "theme"
  | "fs:read"
  | "fs:write"
  | "net"
  | "events:emit"
  | "events:receive";

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  type: "css" | "theme" | "css+js";
  entrypoints: {
    css?: string;
    js?: string;
    theme?: string;
  };
  min_app_version?: string;
  /** Mod 针对的 API 版本（如 "2.1.0"）；不声明则跳过版本协商 */
  api_version?: string;
  /** 权限声明列表；声明后运行时强制执行，不声明则不受限 */
  permissions?: ModPermission[];
  /** Mod 间通信的事件约定 */
  events?: {
    /** 本 mod 会发出的事件名列表 */
    exports?: string[];
    /** 本 mod 会监听的事件名列表 */
    imports?: string[];
  };
  /**
   * 依赖声明：modId → 版本要求（语义版本表达式，如 "^1.0.0"、">=2.0.0"）。
   * 加载时会检查已启用的 mod 是否满足版本要求；不满足则标记为不兼容。
   */
  dependencies?: Record<string, string>;
  /**
   * 加载顺序控制：确保本 mod 在这些 mod 之后加载。
   * 用于无直接依赖但需等待其他 mod 初始化完毕的场景。
   */
  load_after?: string[];
}

export interface ModInfo extends ModManifest {
  enabled: boolean;
  path: string;
  /** 是否与当前 App 版本兼容（min_app_version 校验） */
  is_compatible: boolean;
  /** 不兼容原因，is_compatible 为 false 时存在 */
  incompatible_reason?: string;
}

/** Mod 加载错误（manifest 解析失败 / enabled_mods 损坏等） */
export interface ModLoadError {
  dir_name: string;
  error: string;
}
