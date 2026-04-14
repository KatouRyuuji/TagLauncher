/**
 * Mod 权限声明（honor system，UI 显示但不强制执行）
 *   "items:read"    — 调用 getItems()
 *   "tags:read"     — 调用 getTags()
 *   "cabinets:read" — 调用 getCabinets()
 *   "storage"       — 使用 mod 专属 storage
 *   "dom"           — 操作 DOM 结构
 *   "theme"         — 读写 CSS 变量
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
  | "theme";

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
  /** 权限声明列表，UI 展示给用户 */
  permissions?: ModPermission[];
}

export interface ModInfo extends ModManifest {
  enabled: boolean;
  path: string;
}
