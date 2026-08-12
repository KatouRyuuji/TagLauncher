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
import { getThemeTagPresetColors, FALLBACK_TAG_PRESET_COLORS } from "../lib/tagColors";
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
  const { state, start, cancel: rawCancel, reset } = useAiTagging();

  // App 级 allItems 快照（供事件回调读取最新全库，避免闭包过期）
  const allItemsSnapshotRef = useRef(allItems);
  useEffect(() => {
    allItemsSnapshotRef.current = allItems;
  }, [allItems]);

  // running 快照与待打标队列：任务进行中导入的新对象先入队，
  // 当前任务结束后自动补跑，避免静默漏标。
  const runningRef = useRef(state.running);
  useEffect(() => {
    runningRef.current = state.running;
  }, [state.running]);
  const pendingAutoTagRef = useRef<ItemWithTags[]>([]);

  // 用户取消当前任务时一并清空待打标队列——"停止 AI 打标"的手势不应立刻又被队列触发
  const cancel = useCallback(() => {
    pendingAutoTagRef.current = [];
    rawCancel();
  }, [rawCancel]);

  // 按名称查找或创建标签，返回 id。直接读 store 保证同一串行批次内的最新态。
  const ensureTagByName = useCallback(
    async (name: string): Promise<number> => {
      const normalized = name.trim();
      const existing = useAppStore
        .getState()
        .tags.find((t) => t.name.toLowerCase() === normalized.toLowerCase());
      if (existing) return existing.id;
      const colors = getThemeTagPresetColors();
      const palette = colors.length > 0 ? colors : FALLBACK_TAG_PRESET_COLORS;
      const color = palette[Math.floor(Math.random() * palette.length)] ?? "#3b82f6";
      const created = await addTag(normalized, color);
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
    const onTagAll = (event: Event) => {
      const detail = (event as CustomEvent<AiTagAllDetail>).detail;
      const scope = detail?.scope ?? "all";
      const all = allItemsSnapshotRef.current;
      const targets = scope === "untagged" ? all.filter((item) => item.tags.length === 0) : all;
      if (targets.length === 0) {
        showToast(scope === "untagged" ? "没有未打标的对象" : "当前没有对象", "info");
        return;
      }
      if (state.running) {
        showToast("已有打标任务在进行中", "warning");
        return;
      }
      void start(targets, aiPrimitives);
    };
    window.addEventListener(AI_TAG_ALL_EVENT, onTagAll);
    return () => window.removeEventListener(AI_TAG_ALL_EVENT, onTagAll);
  }, [start, aiPrimitives, state.running]);

  // 新对象自动打标（后台静默）
  useEffect(() => {
    const onItemsAdded = (event: Event) => {
      const items = (event as CustomEvent<{ items: ItemWithTags[] }>).detail?.items ?? [];
      if (items.length === 0) return;
      void (async () => {
        try {
          const cfg = await db.aiGetConfig();
          if (!cfg.autoTagOnAdd) return;
          // 后端不再下发明文密钥，用 hasApiKey 判断是否已配置（apiKey 恒为空串）。
          // 与后端 is_configured 口径一致：baseUrl + 密钥 + model 三项缺一不可，
          // 缺 model 时后端会直接报错空转（silent 模式下静默浪费配额）。
          if (!cfg.baseUrl.trim() || !cfg.hasApiKey || !cfg.model.trim()) return;
          const targets = items.filter((item) => item.tags.length === 0);
          if (targets.length === 0) return;
          // 打标任务进行中：start 会直接拒绝（running 守卫），先入队等当前任务结束补跑
          if (runningRef.current) {
            pendingAutoTagRef.current.push(...targets);
            return;
          }
          const tagged = await start(targets, aiPrimitives, { silent: true });
          if (tagged > 0) showToast(`AI 已为 ${tagged} 个新对象自动打标`, "success");
        } catch {
          // 自动打标失败静默处理，不打扰用户导入流程
        }
      })();
    };
    window.addEventListener("taglauncher-items-added", onItemsAdded);
    return () => window.removeEventListener("taglauncher-items-added", onItemsAdded);
  }, [start, aiPrimitives]);

  // 当前打标任务结束后补跑排队的新对象（读取最新全库快照过滤，期间已打标/已删除的自动跳过）
  useEffect(() => {
    if (state.running) return;
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

    void (async () => {
      try {
        const cfg = await db.aiGetConfig();
        if (!cfg.autoTagOnAdd) return;
        if (!cfg.baseUrl.trim() || !cfg.hasApiKey || !cfg.model.trim()) return;
        const tagged = await start(targets, aiPrimitives, { silent: true });
        if (tagged > 0) showToast(`AI 已为 ${tagged} 个新对象自动打标`, "success");
      } catch {
        // 排队补跑失败同样静默处理
      }
    })();
  }, [state.running, start, aiPrimitives]);

  return { state, cancel, reset };
}
