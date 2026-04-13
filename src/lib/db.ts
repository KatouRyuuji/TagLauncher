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
import type { Item, Tag, ItemWithTags, Cabinet } from "../types";

// ---- 项目操作 ----

/** 获取所有项目（含标签信息），按收藏→最近使用→名称排序 */
export async function getItems(): Promise<ItemWithTags[]> {
  return invoke("get_items");
}

/** 添加项目，传入文件/文件夹的完整路径，后端自动检测类型 */
export async function addItem(path: string): Promise<Item> {
  return invoke("add_item", { path });
}

/** 删除项目（关联的标签记录会级联删除） */
export async function removeItem(id: number): Promise<void> {
  return invoke("remove_item", { id });
}

/** 设置项目缩略图路径（传 null 可清除） */
export async function updateItemIcon(itemId: number, iconPath: string | null): Promise<void> {
  return invoke("update_item_icon", { itemId, iconPath });
}

// ---- 标签操作 ----

/** 获取所有标签，按名称排序 */
export async function getTags(): Promise<Tag[]> {
  return invoke("get_tags");
}

/** 新建标签，返回含自增 ID 的 Tag 对象 */
export async function addTag(name: string, color: string): Promise<Tag> {
  return invoke("add_tag", { name, color });
}

/** 更新标签的名称和颜色 */
export async function updateTag(id: number, name: string, color: string): Promise<void> {
  return invoke("update_tag", { id, name, color });
}

/** 删除标签 */
export async function removeTag(id: number): Promise<void> {
  return invoke("remove_tag", { id });
}

/** 设置项目的标签列表（全量替换：先删除所有旧标签，再插入新标签） */
export async function setItemTags(itemId: number, tagIds: number[]): Promise<void> {
  return invoke("set_item_tags", { itemId, tagIds });
}

// ---- 搜索 ----

/** 后端搜索（当前未使用，前端使用 Fuse.js 客户端搜索） */
export async function searchItems(query: string, tagIds: number[]): Promise<ItemWithTags[]> {
  return invoke("search_items", { query, tagIds });
}

// ---- 启动/打开 ----

/** 启动项目（更新 last_used_at 并调用系统 start 命令） */
export async function launchItem(id: number): Promise<void> {
  return invoke("launch_item", { id });
}

/** 在资源管理器中打开项目所在目录 */
export async function openInExplorer(path: string): Promise<void> {
  return invoke("open_in_explorer", { path });
}

// ---- 收藏 ----

/** 切换收藏状态，返回新的收藏状态 */
export async function toggleFavorite(id: number): Promise<boolean> {
  return invoke("toggle_favorite", { id });
}

// ---- 文件柜操作 ----

/** 获取所有文件柜 */
export async function getCabinets(): Promise<Cabinet[]> {
  return invoke("get_cabinets");
}

/** 新建文件柜 */
export async function addCabinet(name: string, color: string): Promise<Cabinet> {
  return invoke("add_cabinet", { name, color });
}

/** 更新文件柜名称和颜色 */
export async function updateCabinet(id: number, name: string, color: string): Promise<void> {
  return invoke("update_cabinet", { id, name, color });
}

/** 删除文件柜 */
export async function removeCabinet(id: number): Promise<void> {
  return invoke("remove_cabinet", { id });
}

/** 添加项目到文件柜（重复添加会被忽略） */
export async function addItemToCabinet(cabinetId: number, itemId: number): Promise<void> {
  return invoke("add_item_to_cabinet", { cabinetId, itemId });
}

/** 从文件柜移除项目 */
export async function removeItemFromCabinet(cabinetId: number, itemId: number): Promise<void> {
  return invoke("remove_item_from_cabinet", { cabinetId, itemId });
}

/** 获取文件柜内的所有项目（含标签信息） */
export async function getCabinetItems(cabinetId: number): Promise<ItemWithTags[]> {
  return invoke("get_cabinet_items", { cabinetId });
}
