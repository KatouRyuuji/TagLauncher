// ============================================================================
// hooks/useAiTagOrchestration.ts — AI 自动打标编排（App 级）
// ============================================================================
// 把 useAiTagging（无状态并发执行器）与应用数据/事件桥接起来：
//   - 提供 getVocabulary / ensureTag / applyItemTags 三个原语；
//   - 监听设置页「一键打标」事件（AI_TAG_ALL_EVENT），按 scope 选目标启动；
//   - 监听「新对象已加入」事件，在开启 autoTagOnAdd 且已配置密钥时后台静默打标。
// 用 allItemsSnapshotRef 让事件回调读取最新全库，避免闭包过期。
// 从 App.tsx 抽离，行为完全保持一致。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useAiTagging, type AiTaggingPrimitives, type AiTagProgress } from "./useAiTagging";
import { pickRandomTagColor } from "../lib/tagColors";
import { showToast } from "../lib/toast";
import { AI_TAG_ALL_EVENT, type AiTagAllDetail } from "../components/AiSettingsSection";
import * as db from "../lib/db";
import type { ItemWithTags, Tag } from "../types";

interface UseAiTagOrchestrationParams {
  allItems: ItemWithTags[];
  addTag: (name: string, color: string) => Promise<Tag>;
  setItemTags: (itemId: number, tagIds: number[]) => Promise<void>;
}

export interface UseAiTagOrchestrationResult {
  /** 打标进度（供 AiTaggingModal 渲染）。 */
  state: AiTagProgress;
  cancel: () => void;
  reset: () => void;
}

export function useAiTagOrchestration({
  allItems,
  addTag,
  setItemTags,
}: UseAiTagOrchestrationParams): UseAiTagOrchestrationResult {
  const { state, start, cancel: rawCancel, reset, isRunning } = useAiTagging();

  // App 级 allItems 快照（供事件回调读取最新全库，避免闭包过期）
  const allItemsSnapshotRef = useRef(allItems);
  useEffect(() => {
    allItemsSnapshotRef.current = allItems;
  }, [allItems]);

  // 待打标队列：任务进行中（或紧凑连续）导入的新对象先入队，由 flushQueuedAutoTag
  // 统一排水。运行态判断一律用 isRunning()（useAiTagging 内部同步 ref，无镜像滞后）——
  // 此前经 effect 镜像 state.running 的 runningRef 有滞后，两个紧凑的 items-added
  // 事件可都通过检查，后到的 start 被守卫拒绝导致该批对象静默漏标。
  const pendingAutoTagRef = useRef<ItemWithTags[]>([]);

  // 用户取消当前任务时一并清空待打标队列——"停止 AI 打标"的手势不应立刻又被队列触发
  const cancel = useCallback(() => {
    pendingAutoTagRef.current = [];
    rawCancel();
  }, [rawCancel]);

  // 当前批次的 allowNewTags 配置（每次启动前从后端已保存配置刷新）：
  // ensureTag 据此决定词表外标签是创建还是跳过
  const allowNewTagsRef = useRef(true);

  // 按名称查找或创建标签，返回 id；禁止新建且不在词表时返回 null（跳过，不创建）。
  // 直接读 store 保证同一串行批次内的最新态。
  const ensureTagByName = useCallback(
    async (name: string): Promise<number | null> => {
      const normalized = name.trim();
      const existing = useAppStore
        .getState()
        .tags.find((t) => t.name.toLowerCase() === normalized.toLowerCase());
      if (existing) return existing.id;
      // 后端已按词表过滤（allow_new_tags=false 时），此处是第二道防线
      if (!allowNewTagsRef.current) return null;
      const created = await addTag(normalized, pickRandomTagColor());
      return created.id;
    },
    [addTag],
  );

  const aiPrimitives = useMemo<AiTaggingPrimitives>(
    () => ({
      getVocabulary: () => useAppStore.getState().tags.map((t) => t.name),
      ensureTag: ensureTagByName,
      applyItemTags: setItemTags,
    }),
    [ensureTagByName, setItemTags],
  );

  // 设置页触发的"一键打标"
  useEffect(() => {
    const onTagAll = async (event: Event) => {
      const detail = (event as CustomEvent<AiTagAllDetail>).detail;
      const scope = detail?.scope ?? "all";
      // 与 flushQueuedAutoTag 同口径：启动前校验后端已保存配置，
      // 防止把设置页未保存的输入当作已配置
      const cfg = await db.aiGetConfig().catch(() => null);
      if (!cfg || !cfg.baseUrl.trim() || !cfg.hasApiKey || !cfg.model.trim()) {
        showToast("请先填写并保存 API 配置", "warning");
        return;
      }
      allowNewTagsRef.current = cfg.allowNewTags;
      const all = allItemsSnapshotRef.current;
      const targets = scope === "untagged" ? all.filter((item) => item.tags.length === 0) : all;
      if (targets.length === 0) {
        showToast(scope === "untagged" ? "没有未打标的对象" : "当前没有对象", "info");
        return;
      }
      // 运行态用同步 isRunning() 判断：渲染态 state.running 有镜像滞后，
      // 会竞态静默吞掉紧挨着发起的第二批请求
      if (isRunning()) {
        showToast("打标正在进行中", "warning");
        return;
      }
      void start(targets, aiPrimitives);
    };
    window.addEventListener(AI_TAG_ALL_EVENT, onTagAll);
    return () => window.removeEventListener(AI_TAG_ALL_EVENT, onTagAll);
  }, [start, aiPrimitives, isRunning]);

  // 排队新对象的统一排水：去重/去已打标后检查配置并启动静默打标。
  // 启动前用同步 isRunning() 复核（aiGetConfig 的 await 间隙可能已有任务启动），
  // 运行中则回排，由当前任务结束后的补跑 effect 接手，任何时序下目标不丢失。
  const flushQueuedAutoTag = useCallback(async () => {
    const queued = pendingAutoTagRef.current;
    if (queued.length === 0) return;
    pendingAutoTagRef.current = [];

    const freshById = new Map(allItemsSnapshotRef.current.map((item) => [item.id, item]));
    const seen = new Set<number>();
    const targets = queued
      .map((queuedItem) => freshById.get(queuedItem.id))
      .filter((item): item is ItemWithTags => !!item && item.tags.length === 0)
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
    if (targets.length === 0) return;

    // 取配置失败（DB 暂不可读等瞬态）或配置不完整：恢复队列不丢该批对象，
    // 待下次事件/任务结束后的补跑再试。autoTagOnAdd 关闭是用户显式意图，不回排。
    let cfg;
    try {
      cfg = await db.aiGetConfig();
    } catch (e) {
      console.warn("[AI 自动打标] 读取配置失败，待打标对象已回排", e);
      pendingAutoTagRef.current.push(...targets);
      return;
    }
    // 后端不再下发明文密钥，用 hasApiKey 判断是否已配置（apiKey 恒为空串）。
    if (!cfg.autoTagOnAdd) return;
    if (!cfg.baseUrl.trim() || !cfg.hasApiKey || !cfg.model.trim()) {
      pendingAutoTagRef.current.push(...targets);
      return;
    }
    allowNewTagsRef.current = cfg.allowNewTags;
    if (isRunning()) {
      pendingAutoTagRef.current.push(...targets);
      return;
    }
    try {
      const result = await start(targets, aiPrimitives, { silent: true });
      if (result.tagged > 0) showToast(`AI 已为 ${result.tagged} 个新对象自动打标`, "success");
      // silent 批次不弹进度框：失败必须可见——汇总 toast + console 留痕
      if (result.failed > 0) {
        console.warn(`[AI 自动打标] ${result.failed} 个对象自动打标失败`, result.failures);
        showToast(`自动打标失败 ${result.failed} 个对象`, "error");
      }
    } catch (e) {
      // start 自身异常（区别于单对象失败）：回排该批对象并留痕，不静默丢弃
      console.warn("[AI 自动打标] 自动打标批次异常中断，待打标对象已回排", e);
      pendingAutoTagRef.current.push(...targets);
    }
  }, [isRunning, start, aiPrimitives]);

  // 新对象自动打标（后台静默）：先入队再排水，任务运行中由补跑 effect 接手
  useEffect(() => {
    const onItemsAdded = (event: Event) => {
      const items = (event as CustomEvent<{ items: ItemWithTags[] }>).detail?.items ?? [];
      if (items.length === 0) return;
      pendingAutoTagRef.current.push(...items.filter((item) => item.tags.length === 0));
      if (isRunning()) return;
      void flushQueuedAutoTag();
    };
    window.addEventListener("taglauncher-items-added", onItemsAdded);
    return () => window.removeEventListener("taglauncher-items-added", onItemsAdded);
  }, [isRunning, flushQueuedAutoTag]);

  // 当前打标任务结束后补跑排队的新对象
  useEffect(() => {
    if (state.running) return;
    void flushQueuedAutoTag();
  }, [state.running, flushQueuedAutoTag]);

  return { state, cancel, reset };
}
