/**
 * Mod 权限声明。
 *
 * ⚠️ 权限声明**不是安全沙箱边界**：Mod JS 运行于应用主 realm，拥有与宿主相同的完全能力，
 *    可绕过本层直接调用后端命令。权限的作用是：(1) 面向用户的能力/意图标注（启用前 UI 展示）；
 *    (2) 对经 createScope 的「守规矩」调用做 API 误用防呆。安装/启用 mod 前须确认来源可信。
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
 *   "fs:read"         — 读取 mod 自身目录内文件
 *   "fs:write"        — 写入 mod 自身目录内文件
 *   "net"             — 网络访问
 *   "events:emit"     — 发送 mod 间事件
 *   "events:receive"  — 接收 mod 间事件
 *   "objects:preview" — 读取被管理对象的预览信息和资源 URL
 *   "data"            — mod 专属数据库存储
 *
 * 若 permissions 未声明（undefined），则经 createScope 的调用不受限（向后兼容）。
 * 若 permissions 为 []，则经 createScope 的调用无任何权限（但 mod 仍可绕过本层，见上）。
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
  | "events:receive"
  | "objects:preview"
  | "data";

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
  /** 最高兼容版本（exclusive）：App 版本高于此值时后端标记不兼容 */
  max_app_version?: string;
  /** Mod 针对的 API 版本（如 "2.1.0"）；不声明则跳过版本协商 */
  api_version?: string;
  /** 权限声明列表：能力/意图标注 + 对 createScope 调用的误用防呆，非安全沙箱（详见 ModPermission） */
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
  /** 宿主 UI 贡献点声明：菜单、路由、状态栏、设置页、快捷键、后台任务等 */
  contributes?: ModContributes;
  /**
   * 加载顺序控制：确保本 mod 在这些 mod 之后加载。
   * 用于无直接依赖但需等待其他 mod 初始化完毕的场景。
   */
  load_after?: string[];
}

export interface ModContributes {
  routes?: Array<{ id: string; title: string; path: string; icon?: string }>;
  menuItems?: Array<{ id: string; title: string; command: string; location?: string; icon?: string }>;
  commands?: Array<{ id: string; title: string; description?: string }>;
  statusItems?: Array<{ id: string; title: string; align?: "left" | "right" }>;
  settingsPages?: Array<{ id: string; title: string; icon?: string }>;
  shortcuts?: Array<{ command: string; keys: string }>;
  backgroundTasks?: Array<{ id: string; intervalMs?: number }>;
  notifications?: Array<{ id: string; title: string }>;
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
