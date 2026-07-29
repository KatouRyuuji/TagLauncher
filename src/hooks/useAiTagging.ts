// ============================================================================
// hooks/useAiTagging.ts — AI 自动打标编排
// ============================================================================
// 后端 ai_suggest_tags 是"给一个对象建议标签"的无状态原语；本 hook 负责：
// - 并发池（CONCURRENCY）加速慢速 API 调用；
// - 标签创建/应用串行化（applyChain 互斥），避免两个对象同时新建同名标签产生重复；
// - 进度、成功/跳过/失败计数、可取消；
// - silent 模式用于"新对象自动打标"（不弹进度框，仅后台执行）。
// ============================================================================

import { useState, useRef, useCallback } from "react";
import * as db from "../lib/db";
import type { ItemWithTags } from "../types";

const CONCURRENCY = 3;

export interface AiTagProgress {
  running: boolean;
  silent: boolean;
  total: number;
  done: number;
  succeeded: number;
  skipped: number;
  failed: number;
  lastNames: string[];
  errors: Array<{ name: string; error: string }>;
  canceled: boolean;
}

export interface AiTaggingPrimitives {
  /** 返回当前全部标签名，作为词表引导模型复用 */
  getVocabulary: () => string[];
  /** 按名称查找或创建标签，返回其 id（内部需保证同名唯一） */
  ensureTag: (name: string) => Promise<number>;
  /** 全量设置对象标签 */
  applyItemTags: (itemId: number, tagIds: number[]) => Promise<void>;
}

const INITIAL: AiTagProgress = {
  running: false,
  silent: false,
  total: 0,
  done: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  lastNames: [],
  errors: [],
  canceled: false,
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAiTagging() {
  const [state, setState] = useState<AiTagProgress>(INITIAL);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    setState((s) => ({ ...s, canceled: true }));
  }, []);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setState(INITIAL);
  }, []);

  /** 开始批量打标。silent=true 时后台执行不弹窗。返回本次成功打标的对象数。 */
  const start = useCallback(
    async (
      items: ItemWithTags[],
      primitives: AiTaggingPrimitives,
      options?: { silent?: boolean },
    ): Promise<number> => {
      if (runningRef.current || items.length === 0) return 0;
      runningRef.current = true;
      cancelRef.current = false;
      const silent = options?.silent ?? false;
      setState({ ...INITIAL, running: true, silent, total: items.length });

      const queue = [...items];
      let applyChain: Promise<void> = Promise.resolve();
      let succeededCount = 0;

      const worker = async () => {
        for (;;) {
          if (cancelRef.current) break;
          const item = queue.shift();
          if (!item) break;

          try {
            const names = await db.aiSuggestTags(
              item.name,
              item.path,
              item.type,
              primitives.getVocabulary(),
            );
            if (cancelRef.current) break;

            if (names.length === 0) {
              setState((s) => ({ ...s, done: s.done + 1, skipped: s.skipped + 1 }));
              continue;
            }

            // 串行化：确保标签创建与应用不并发，避免重复建标。
            // catch(()=>{}) 吞掉前序对象的失败再接续——链上某一对象应用失败不应
            // 波及后续对象（否则链永久 rejected：后续全部跳过且误记为同一个错误）。
            applyChain = applyChain.catch(() => {}).then(async () => {
              const ids: number[] = [];
              for (const name of names) {
                ids.push(await primitives.ensureTag(name));
              }
              // 应用时重取对象最新标签再合并：批量打标可能运行数分钟，期间用户手动
              // 增删该对象的标签会被"开始时的 item.tags 快照"全量替换覆盖（新增丢失、
              // 删除复活）。对象已被删除时 getItem 抛错 → 由 worker catch 归因到本对象。
              const fresh = await db.getItem(item.id);
              const merged = Array.from(new Set([...fresh.tags.map((t) => t.id), ...ids]));
              await primitives.applyItemTags(item.id, merged);
            });
            await applyChain;

            succeededCount += 1;
            setState((s) => ({
              ...s,
              done: s.done + 1,
              succeeded: s.succeeded + 1,
              lastNames: names,
            }));
          } catch (e) {
            setState((s) => ({
              ...s,
              done: s.done + 1,
              failed: s.failed + 1,
              errors: [...s.errors, { name: item.name, error: errorMessage(e) }].slice(-50),
            }));
          }
        }
      };

      const poolSize = Math.min(CONCURRENCY, items.length);
      await Promise.all(Array.from({ length: poolSize }, () => worker()));

      setState((s) => ({ ...s, running: false, canceled: cancelRef.current }));
      runningRef.current = false;
      return succeededCount;
    },
    [],
  );

  return { state, start, cancel, reset, isRunning: () => runningRef.current };
}
