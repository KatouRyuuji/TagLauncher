// ============================================================================
// lib/db.ts — Tauri 命令封装层
// ============================================================================
// 将所有 Rust 后端命令封装为类型安全的 TypeScript 函数。
// 前端代码通过此模块与后端通信，而不是直接调用 invoke()。
//
// 设计意图：
// - 集中管理所有 IPC 调用，方便查找和维护
// - 提供类型推断，避免手写泛型参数
// - 如果将来更换后端（如 HTTP API），只需修改此文件
//
// 注意：invoke 的参数名必须与 Rust 函数的参数名完全一致（Tauri 按名称匹配）
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import type { Item, Tag, TagRelation, ItemWithTags, Cabinet } from "../types";

/**
 * 统一的 invoke 包装：捕获后端错误并抛出带命令名的可读错误，
 * 便于上层 toast 与日志定位。返回类型与 invoke 一致。
 */
async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw new Error(`[${cmd}] ${err instanceof Error ? err.message : String(err)}`);
  }
}
import type { ModInfo, ModLoadError } from "../types/mod";
import type {
  CustomThemesResult,
  ThemeDefinition,
  ThemeDirectoryInfo,
  ThemeExportPayload,
  ThemeInstallResult,
} from "../types/theme";

// ---- 项目操作 ----

/** 获取所有项目（含标签信息），按收藏→最近使用→名称排序 */
export async function getItems(): Promise<ItemWithTags[]> {
  return invokeCmd("get_items");
}

/** 获取单个项目（含标签信息和自动图标） */
export async function getItem(id: number): Promise<ItemWithTags> {
  return invokeCmd("get_item", { id });
}

/** 批量获取指定项目（含标签信息和自动图标） */
export async function getItemsByIds(ids: number[]): Promise<ItemWithTags[]> {
  return invokeCmd("get_items_by_ids", { ids });
}

/** 添加项目，传入文件/文件夹的完整路径，后端自动检测类型 */
export async function addItem(path: string): Promise<Item> {
  return invokeCmd("add_item", { path });
}

export interface AddItemsResult {
  items: Item[];
  failed: Array<{ path: string; error: string }>;
}

/** 批量添加项目，单条失败不会阻断整批导入 */
export async function addItems(paths: string[]): Promise<AddItemsResult> {
  return invokeCmd("add_items", { paths });
}

/** 删除项目（关联的标签记录会级联删除） */
export async function removeItem(id: number): Promise<void> {
  return invokeCmd("remove_item", { id });
}

/** 批量删除项目（后端单条 IN 语句，原子） */
export async function removeItems(ids: number[]): Promise<void> {
  return invokeCmd("remove_items", { ids });
}

/** 批量设置多个对象的标签（后端整批一个事务，原子） */
export async function setManyItemTags(
  changes: Array<{ itemId: number; tagIds: number[] }>,
): Promise<void> {
  return invokeCmd("set_many_item_tags", { changes });
}

/** 设置项目缩略图路径（传 null 可清除） */
export async function updateItemIcon(itemId: number, iconPath: string | null): Promise<void> {
  return invokeCmd("update_item_icon", { itemId, iconPath });
}

// ---- 标签操作 ----

/** 获取所有标签，按名称排序 */
export async function getTags(): Promise<Tag[]> {
  return invokeCmd("get_tags");
}

/** 新建标签，返回含自增 ID 的 Tag 对象 */
export async function addTag(name: string, color: string): Promise<Tag> {
  return invokeCmd("add_tag", { name, color });
}

/** 更新标签的名称和颜色 */
export async function updateTag(id: number, name: string, color: string): Promise<void> {
  return invokeCmd("update_tag", { id, name, color });
}

/** 删除标签 */
export async function removeTag(id: number): Promise<void> {
  return invokeCmd("remove_tag", { id });
}

/** 设置项目的标签列表（全量替换：先删除所有旧标签，再插入新标签） */
export async function setItemTags(itemId: number, tagIds: number[]): Promise<void> {
  return invokeCmd("set_item_tags", { itemId, tagIds });
}

// ---- 标签层级关系（DAG，多继承） ----

/** 获取所有父子关系边 */
export async function getTagRelations(): Promise<TagRelation[]> {
  return invokeCmd("get_tag_relations");
}

/** 新增父子关系（后端会拒绝自环/成环关系，抛出错误） */
export async function addTagRelation(parentId: number, childId: number): Promise<void> {
  return invokeCmd("add_tag_relation", { parentId, childId });
}

/** 删除父子关系 */
export async function removeTagRelation(parentId: number, childId: number): Promise<void> {
  return invokeCmd("remove_tag_relation", { parentId, childId });
}

// ---- 搜索 ----

/** 后端搜索（当前未使用，主界面使用前端内存搜索） */
export async function searchItems(query: string, tagIds: number[]): Promise<ItemWithTags[]> {
  return invokeCmd("search_items", { query, tagIds });
}

// ---- 启动/打开 ----

/** 启动项目（更新 last_used_at 并调用系统 start 命令） */
export async function launchItem(id: number): Promise<void> {
  return invokeCmd("launch_item", { id });
}

/** 在资源管理器中打开项目所在目录 */
export async function openInExplorer(path: string): Promise<void> {
  return invokeCmd("open_in_explorer", { path });
}

/** 按对象 id 打开所在目录（后端先按文件ID重定位到当前真实路径，避免路径已失效） */
export async function openInExplorerById(id: number): Promise<void> {
  return invokeCmd("open_in_explorer_by_id", { id });
}

// ---- 对象预览 ----

export interface ObjectPreviewFileInfo {
  name: string;
  path: string;
  item_type: string;
  is_file: boolean;
  is_dir: boolean;
  size: number | null;
  modified_at_secs: number | null;
}

export interface ObjectDirectoryEntry {
  name: string;
  path: string;
  item_type: string;
  is_file: boolean;
  is_dir: boolean;
  size: number | null;
}

export interface AudioPreviewInfo {
  duration_ms: number | null;
  sample_rate: number | null;
  encoding: string | null;
  bitrate_kbps: number | null;
  bit_depth: number | null;
  channels: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_cover_data_url: string | null;
}

export async function getObjectFileInfo(path: string): Promise<ObjectPreviewFileInfo> {
  return invokeCmd("get_object_file_info", { path });
}

export async function listObjectDirectory(path: string): Promise<ObjectDirectoryEntry[]> {
  return invokeCmd("list_object_directory", { path });
}

export async function getAudioPreview(path: string): Promise<AudioPreviewInfo> {
  return invokeCmd("get_audio_preview", { path });
}

// ---- 收藏 ----

/** 切换收藏状态，返回新的收藏状态 */
export async function toggleFavorite(id: number): Promise<boolean> {
  return invokeCmd("toggle_favorite", { id });
}

// ---- 跨盘符兜底找回 ----

/** 对失效对象按内容签名做跨盘找回，返回成功找回数量（扫描在后端锁外进行） */
export async function relocateMissing(): Promise<number> {
  return invokeCmd("relocate_missing");
}

// ---- Mod 网络 API ----

export interface NetFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface NetFetchResponse {
  status: number;
  headers: Record<string, string>;
  /** 响应体（base64 编码）*/
  body: string;
}

/**
 * Mod 网络原语：仅支持 http/https，强制超时与响应体大小上限（10MB）。
 * 供 modApi net.fetch 调用；业务逻辑由 Mod 自行实现。
 */
export async function netFetch(req: NetFetchRequest): Promise<NetFetchResponse> {
  return invokeCmd("net_fetch", { req });
}

// ---- 文件柜操作 ----

/** 获取所有文件柜 */
export async function getCabinets(): Promise<Cabinet[]> {
  return invokeCmd("get_cabinets");
}

/** 新建文件柜 */
export async function addCabinet(name: string, color: string): Promise<Cabinet> {
  return invokeCmd("add_cabinet", { name, color });
}

/** 更新文件柜名称和颜色 */
export async function updateCabinet(id: number, name: string, color: string): Promise<void> {
  return invokeCmd("update_cabinet", { id, name, color });
}

/** 删除文件柜 */
export async function removeCabinet(id: number): Promise<void> {
  return invokeCmd("remove_cabinet", { id });
}

/** 添加项目到文件柜（重复添加会被忽略） */
export async function addItemToCabinet(cabinetId: number, itemId: number): Promise<void> {
  return invokeCmd("add_item_to_cabinet", { cabinetId, itemId });
}

/** 从文件柜移除项目 */
export async function removeItemFromCabinet(cabinetId: number, itemId: number): Promise<void> {
  return invokeCmd("remove_item_from_cabinet", { cabinetId, itemId });
}

/** 批量将项目加入文件柜（后端整批一个事务，幂等） */
export async function addItemsToCabinet(cabinetId: number, itemIds: number[]): Promise<void> {
  return invokeCmd("add_items_to_cabinet", { cabinetId, itemIds });
}

/** 批量从文件柜移除项目（后端单条 IN 语句，原子） */
export async function removeItemsFromCabinet(cabinetId: number, itemIds: number[]): Promise<void> {
  return invokeCmd("remove_items_from_cabinet", { cabinetId, itemIds });
}

/** 获取文件柜内的所有项目（含标签信息） */
export async function getCabinetItems(cabinetId: number): Promise<ItemWithTags[]> {
  return invokeCmd("get_cabinet_items", { cabinetId });
}

// ---- 设置 ----

/** 获取应用版本 */
export async function getAppVersion(): Promise<string> {
  return invokeCmd("get_app_version");
}

/** 获取当前主题 ID */
export async function getCurrentTheme(): Promise<string> {
  return invokeCmd("get_current_theme");
}

/** 设置当前主题 */
export async function setCurrentTheme(themeId: string): Promise<void> {
  return invokeCmd("set_current_theme", { themeId });
}

/** 获取设置值 */
export async function getSetting(key: string): Promise<string | null> {
  return invokeCmd("get_setting", { key });
}

/** 写入设置值 */
export async function setSetting(key: string, value: string): Promise<void> {
  return invokeCmd("set_setting", { key, value });
}

// ---- Mod 操作 ----

/** 获取所有 mod 列表 */
export async function getMods(): Promise<ModInfo[]> {
  return invokeCmd("get_mods");
}

/** 获取自定义 JSON 主题列表（含加载错误） */
export async function getCustomThemes(): Promise<CustomThemesResult> {
  return invokeCmd("get_custom_themes");
}

/** 获取应用主题目录信息 */
export async function getThemeDirectoryInfo(): Promise<ThemeDirectoryInfo> {
  return invokeCmd("get_theme_directory_info");
}

/** 导入主题 JSON 文件到应用主题目录 */
export async function installThemeFile(sourcePath: string): Promise<ThemeInstallResult> {
  return invokeCmd("install_theme_file", { sourcePath });
}

/** 导出主题到指定路径 */
export async function exportThemeFile(theme: ThemeDefinition, targetPath: string): Promise<ThemeExportPayload> {
  return invokeCmd("export_theme_file", { theme, targetPath });
}

/** 获取启动时收集的 mod 加载错误 */
export async function getModLoadErrors(): Promise<ModLoadError[]> {
  return invokeCmd("get_mod_load_errors");
}

/** 获取 mod 入口文件内容 */
export async function getModContent(modId: string, entrypoint: string): Promise<string> {
  return invokeCmd("get_mod_content", { modId, entrypoint });
}

/** 获取 mod 的绝对目录路径（用于解析 mod 主题包内 assets/fonts 相对路径） */
export async function getModDir(modId: string): Promise<string> {
  return invokeCmd("get_mod_dir", { modId });
}

/** 启用 mod */
export async function enableMod(modId: string): Promise<void> {
  return invokeCmd("enable_mod", { modId });
}

/** 禁用 mod */
export async function disableMod(modId: string): Promise<void> {
  return invokeCmd("disable_mod", { modId });
}

/** 卸载 mod：从注册表和文件系统中彻底删除 */
export async function deleteMod(modId: string): Promise<void> {
  return invokeCmd("delete_mod", { modId });
}

/** 获取 mod 安装状态：new / updated:<oldVersion> / unchanged */
export async function getModInstallState(modId: string): Promise<string> {
  return invokeCmd("get_mod_install_state", { modId });
}

/** 标记 mod 版本已记录（install/update 生命周期触发后调用） */
export async function markModVersion(modId: string, version: string): Promise<void> {
  return invokeCmd("mark_mod_version", { modId, version });
}

// ---- Mod 数据存储 ----

export async function modKvGet(modId: string, key: string): Promise<string | null> {
  return invokeCmd("mod_kv_get", { modId, key });
}

export async function modKvSet(modId: string, key: string, value: string): Promise<void> {
  return invokeCmd("mod_kv_set", { modId, key, value });
}

export async function modKvRemove(modId: string, key: string): Promise<void> {
  return invokeCmd("mod_kv_remove", { modId, key });
}

export async function modRecordsList(modId: string, collection: string): Promise<string[]> {
  return invokeCmd("mod_records_list", { modId, collection });
}

export async function modRecordPut(modId: string, collection: string, id: string, value: string): Promise<void> {
  return invokeCmd("mod_record_put", { modId, collection, id, value });
}

export async function modRecordRemove(modId: string, collection: string, id: string): Promise<void> {
  return invokeCmd("mod_record_remove", { modId, collection, id });
}

// ---- Mod 文件系统 ----

export async function readModFile(modId: string, relativePath: string): Promise<string> {
  return invokeCmd("read_mod_file", { modId, relativePath });
}

export async function readModFileBytes(modId: string, relativePath: string): Promise<number[]> {
  return invokeCmd("read_mod_file_bytes", { modId, relativePath });
}

export async function writeModFile(modId: string, relativePath: string, content: string): Promise<void> {
  return invokeCmd("write_mod_file", { modId, relativePath, content });
}

export async function writeModFileBytes(modId: string, relativePath: string, bytes: number[]): Promise<void> {
  return invokeCmd("write_mod_file_bytes", { modId, relativePath, bytes });
}

export async function listModFiles(modId: string, relativePath: string): Promise<Array<{ name: string; is_file: boolean; is_dir: boolean }>> {
  return invokeCmd("list_mod_files", { modId, relativePath });
}

export async function removeModFile(modId: string, relativePath: string): Promise<void> {
  return invokeCmd("remove_mod_file", { modId, relativePath });
}

// ---- Mod 导入导出 ----

export async function importMod(sourcePath: string): Promise<ModInfo> {
  return invokeCmd("import_mod", { sourcePath });
}

export async function exportMod(modId: string, targetDir: string): Promise<string> {
  return invokeCmd("export_mod", { modId, targetDir });
}
