import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { buildSearchIndex, filterItemsByTags, filterSearchIndex, searchWithIndex } from "../lib/search";
import { ensurePinyin } from "../lib/pinyinProvider";
import { applyTypeFilter, applyWorkspaceQuery, sortItemsByMode } from "../lib/itemQuery";
import { buildDescendantsMap } from "../lib/tagGraph";
import { notifyItemLaunched, notifyItemsChanged, notifyCabinetItemsChanged } from "../lib/modApi";
import { showToast } from "../lib/toast";
import { TAGS_WRITTEN_EVENT } from "./useTags";

/** 搜索索引闲时预热的单片大小（1000 条/片，片间让出主线程） */
const SEARCH_WARM_SLICE = 1000;
/** 预热片间隔：单片构建 ~100-200ms，间隔拉长避免 IPC/交互排队超过人感阈值 */
const SEARCH_WARM_GAP_MS = 250;
/** 预热条目上限：超大库不为全量预热付首分钟成本——
 *  前 5000 条（最近使用头部）覆盖高频命中，其余靠首次搜索的防抖窗口构建 */
const SEARCH_WARM_MAX_ENTRIES = 5000;

/** 主题换色后的就地改色事件：detail.tagColors = { tagId: color }。
 *  只改颜色不动结构，无需 TAGS_WRITTEN_EVENT 的全量重取级联。 */
export const ITEM_TAG_COLORS_PATCH_EVENT = "taglauncher-item-tag-colors-patch";
import { invalidateItemVisuals } from "../lib/itemVisualCache";
import type { ItemWithTags } from "../types";

/** 批量收藏请求事件（ContextMenu 多选收藏走此通道，detail: { ids, favorite }）。 */
export const SET_FAVORITES_EVENT = "taglauncher-set-favorites";

/**
 * 写操作错误反馈包装：失败时弹出可读 toast 再向上抛出。
 * 保持原行为——本地乐观更新只在写成功后进行，失败抛出即跳过本地更新。
 */
async function withErrorToast<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    showToast(`${action}失败：${detail}`, "error");
    throw e;
  }
}

function getPathDisplayName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// 与 itemQuery.compareItems 的 "smart" 模式同一实现：收藏 → 最近使用 → 名称。
function sortItems(items: ItemWithTags[]): ItemWithTags[] {
  return sortItemsByMode(items, "smart");
}

function upsertItem(items: ItemWithTags[], item: ItemWithTags): ItemWithTags[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) {
    return sortItems([...items, item]);
  }

  const next = [...items];
  next[index] = item;
  return sortItems(next);
}

function upsertItems(items: ItemWithTags[], changedItems: ItemWithTags[]): ItemWithTags[] {
  if (changedItems.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of changedItems) {
    byId.set(item.id, item);
  }

  return sortItems(Array.from(byId.values()));
}

function removeItemFromList(items: ItemWithTags[], id: number): ItemWithTags[] {
  return items.filter((item) => item.id !== id);
}

/** 稳定的空数组引用：切柜期间 cabinetItems 尚未归属新柜时回退，避免闪现旧柜内容。 */
const EMPTY_ITEMS: ItemWithTags[] = [];

export function useItems() {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchMode = useAppStore((state) => state.searchMode);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const sortMode = useAppStore((state) => state.sortMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [allItems, setAllItems] = useState<ItemWithTags[]>([]);
  const [cabinetItems, setCabinetItems] = useState<ItemWithTags[]>([]);
  // cabinetItems 当前归属的文件柜 id：切柜后新数据到达前，用它判断 cabinetItems 是否已对应
  // 当前选中柜，避免短暂显示上一个柜子的内容（竞态视觉错位）。
  const [cabinetItemsOwner, setCabinetItemsOwner] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // 最近一次列表加载失败的可读错误（成功后清空）：供 UI 在库为空时渲染
  // 可重试的错误面板，而不是把后端故障静默呈现为「暂无项目」。
  const [loadError, setLoadError] = useState<string | null>(null);
  const allItemsRef = useRef<ItemWithTags[]>([]);
  const cabinetItemsRef = useRef<ItemWithTags[]>([]);
  const relocatingRef = useRef<Promise<number> | null>(null);
  const relocateMissingRef = useRef<() => void>(() => {});
  // 闲时预热定时器（取消/卸载清理用）
  const warmupTimerRef = useRef<{ kind: "idle"; id: number } | { kind: "timeout"; id: ReturnType<typeof setTimeout> } | null>(null);
  // 会话内冻结排序键：启动对象只刷新 last_used_at 不重排视图（Explorer 语义）。
  // 快照重拍时机 = loadAll 成功 / 排序变更 / 视图域切换；launch 的 refreshItemById 不重拍
  const frozenSortKeysRef = useRef<ReadonlyMap<number, string | null | undefined> | null>(null);
  const captureFrozenSortKeys = useCallback(
    (items: ItemWithTags[]) => new Map(items.map((item) => [item.id, item.last_used_at] as const)),
    [],
  );
  // 预热代数：每次取消/重调度自增；挂在 pinyin 分片与切片链上的回调凭代数判断是否已被取代
  const warmupGenRef = useRef(0);
  const cancelSearchWarmup = useCallback(() => {
    warmupGenRef.current += 1;
    if (warmupTimerRef.current === null) return;
    if (warmupTimerRef.current.kind === "idle") window.cancelIdleCallback?.(warmupTimerRef.current.id);
    else clearTimeout(warmupTimerRef.current.id);
    warmupTimerRef.current = null;
  }, []);
  useEffect(() => cancelSearchWarmup, [cancelSearchWarmup]);
  // 仅首屏加载显示整屏 loading；后台刷新（刷新按钮/跨盘找回后）保留旧列表原地更新，
  // 不清空、不闪 spinner、不丢滚动位置。
  const initialLoadRef = useRef(true);
  // 进行中的加载 Promise：并发触发 refresh（刷新按钮 + Mod 桥接 + 跨盘找回等）
  // 时共享同一次请求，避免多次全量 IO 与响应交错互相覆盖。
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    allItemsRef.current = allItems;
    notifyItemsChanged(allItems);
  }, [allItems]);

  useEffect(() => {
    cabinetItemsRef.current = cabinetItems;
  }, [cabinetItems]);

  const loadAll = useCallback((): Promise<void> => {
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const task = (async () => {
      if (initialLoadRef.current) setLoading(true);
      try {
        // 记录刷新前的失效态，用于检测"本次新变为失效"的对象并主动提示
        const prev = new Map(allItemsRef.current.map((i) => [i.id, i]));
        const data = await db.getItems(false);
        // 不在此失效图标缓存：getItems(false) 不触碰 icon_path，内部级联（标签写/
        // 主题换色）不应引发图标重取；手动刷新入口单独负责图标失效
        setAllItems(data);
        // 全量加载 = 显式重排点：重拍冻结排序键
        frozenSortKeysRef.current = captureFrozenSortKeys(data);
        // 搜索索引闲时预热（含 pinyin-pro 懒加载分片）：首次击键不再全量构建。
        // 模块级 searchFieldsCache 按内容指纹跨刷新复用，预热只补未命中条目。
        // 取消上一次未触发的预热并随卸载清理：避免陈旧定时器在新数据/新会话上误建
        cancelSearchWarmup();
        const warmupGen = warmupGenRef.current;
        const warm = () => {
          warmupTimerRef.current = null;
          void ensurePinyin().then(() => {
            // 分片到达时本轮预热可能已被取代（新一轮 loadAll）：代数不符直接放弃，
            // 否则旧链会用陈旧数据建片并与新链交错、双倍占用主线程
            if (warmupGen !== warmupGenRef.current) return;
            // 1000 条/片 × 250ms 间隔的空闲切片预热（上限 5000 条）：
            // 整块构建在 10k+ 库上会冻结主线程数秒；超大库只暖头部高频区
            const warmTarget = Math.min(data.length, SEARCH_WARM_MAX_ENTRIES);
            const step = (start: number) => {
              if (warmupGen !== warmupGenRef.current) return; // 已被取消/取代
              if (start >= warmTarget) {
                warmupTimerRef.current = null;
                return;
              }
              buildSearchIndex(data.slice(0, start + SEARCH_WARM_SLICE), "all");
              if (start + SEARCH_WARM_SLICE >= warmTarget) {
                warmupTimerRef.current = null;
                return;
              }
              const next = start + SEARCH_WARM_SLICE;
              warmupTimerRef.current = { kind: "timeout", id: setTimeout(() => step(next), SEARCH_WARM_GAP_MS) };
            };
            step(0);
          }).catch(() => {
            // 分片加载失败（pinyinProvider 已重置）：本轮预热放弃，下次 loadAll/输入重试
          });
        };
        if (typeof window.requestIdleCallback === "function") {
          warmupTimerRef.current = { kind: "idle", id: window.requestIdleCallback(warm, { timeout: 2000 }) };
        } else {
          warmupTimerRef.current = { kind: "timeout", id: setTimeout(warm, 200) };
        }
        setLoadError(null);

        const newlyMissing = data.filter(
          (i) => i.is_missing && prev.has(i.id) && !prev.get(i.id)?.is_missing,
        );
        if (newlyMissing.length > 0) {
          const names = newlyMissing
            .slice(0, 3)
            .map((i) => i.name)
            .join("、");
          const suffix = newlyMissing.length > 3 ? ` 等 ${newlyMissing.length} 个` : "";
          showToast(
            `${newlyMissing.length} 个对象的文件已丢失或移动到其他磁盘：${names}${suffix}（归类已保留，文件恢复后会自动重新关联）`,
            "warning",
          );
          // 兜底：后台按内容签名尝试跨盘找回（扫描在后端 DB 锁外执行，不阻塞）。
          relocateMissingRef.current();
        }
      } catch (e) {
        console.error("Failed to load items:", e);
        const detail = e instanceof Error ? e.message : String(e);
        setLoadError(detail);
        showToast(`加载对象列表失败：${detail}`, "error");
      } finally {
        initialLoadRef.current = false;
        setLoading(false);
      }
    })().finally(() => {
      loadInFlightRef.current = null;
    });

    loadInFlightRef.current = task;
    return task;
  }, []);

  // 跨盘符兜底找回：对失效对象按内容签名扫描候选盘，命中则刷新并提示。
  // 用 relocatingRef 防止并发/重复扫描；成功找回 0 个时保持安静。
  const relocateMissing = useCallback((): Promise<number> => {
    if (relocatingRef.current) return relocatingRef.current;
    const task = (async () => {
      const recovered = await db.relocateMissing();
      if (recovered > 0) {
        await loadAll();
        showToast(`已跨盘找回 ${recovered} 个对象`, "success");
      }
      return recovered;
    })().finally(() => { relocatingRef.current = null; });
    relocatingRef.current = task;
    return task;
  }, [loadAll]);

  useEffect(() => {
    relocateMissingRef.current = () => {
      void relocateMissing().catch((error: unknown) => {
        console.error("跨盘找回失败:", error);
        showToast(`跨盘找回失败：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    };
  }, [relocateMissing]);

  useEffect(() => {
    if (selectedCabinetId === null) {
      // 离开文件柜视图时重置归属：否则再次切回同一柜会因 owner 仍相等而
      // 直接回显离开期间的旧数据（违背"切柜期间回退空数组避免闪现旧数据"的设计）。
      setCabinetItemsOwner(null);
      return;
    }
    // 竞态防护：快速切换文件柜时，慢响应不得覆盖已切换的新选择；
    // 数据到达时一并记录归属，供 source 判定是否已对应当前选中柜。
    let cancelled = false;
    db.getCabinetItems(selectedCabinetId, false)
      .then((data) => {
        if (!cancelled) {
          setCabinetItems(data);
          setCabinetItemsOwner(selectedCabinetId);
        }
      })
      .catch((e) => {
        console.error(e);
        // 失败时柜内容停留在空集（owner 未更新），须让用户可感知而非呈现"空柜"假象
        if (!cancelled) {
          showToast(`加载文件柜内容失败：${e instanceof Error ? e.message : String(e)}`, "error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCabinetId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("folder-watch-imported", () => {
        if (!cancelled) void loadAll();
      }))
      .then((stop) => {
        // listen 是异步注册：cleanup 先于本回调时 unlisten 尚未拿到句柄，
        // 立即停掉，否则监听器永久泄漏（StrictMode 双挂载必现）
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadAll]);

  // 对账解耦：后台对账（启动首跑/60s 节流/手动刷新）有实际写入时，
  // 走纯读 loadAll 同步失效标记与重定位结果（此时已不含对账成本）
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<db.ReconcileSummary>("items-reconciled", (event) => {
        if (!cancelled && event.payload.changed) void loadAll();
      }))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadAll]);

  // 标签改名/删除后，对象卡片上的标签 pill 渲染自 item.tags：监听标签写事件
  // 全量刷新对象，避免卡片残留幽灵标签（旧名称/已删标签）。
  useEffect(() => {
    const handler = () => { void loadAll(); };
    window.addEventListener(TAGS_WRITTEN_EVENT, handler);
    return () => window.removeEventListener(TAGS_WRITTEN_EVENT, handler);
  }, [loadAll]);

  // 主题换色（色位写回）只变 color：按 tag id 就地更新对象内嵌标签色，不走全量重取。
  useEffect(() => {
    const patch = (items: ItemWithTags[], tagColors: Record<number, string>): ItemWithTags[] =>
      items.map((item) => {
        if (!item.tags.some((tag) => tagColors[tag.id] !== undefined)) return item;
        return {
          ...item,
          tags: item.tags.map((tag) =>
            tagColors[tag.id] !== undefined ? { ...tag, color: tagColors[tag.id] } : tag,
          ),
        };
      });
    const handler = (event: Event) => {
      const tagColors = (event as CustomEvent<{ tagColors?: Record<number, string> }>).detail?.tagColors;
      if (!tagColors) return;
      setAllItems((current) => patch(current, tagColors));
      setCabinetItems((current) => patch(current, tagColors));
    };
    window.addEventListener(ITEM_TAG_COLORS_PATCH_EVENT, handler);
    return () => window.removeEventListener(ITEM_TAG_COLORS_PATCH_EVENT, handler);
  }, []);

  const refreshItemById = useCallback(async (itemId: number) => {
    const item = await db.getItem(itemId);
    setAllItems((current) => upsertItem(current, item));
    setCabinetItems((current) =>
      current.some((cabinetItem) => cabinetItem.id === itemId)
        ? upsertItem(current, item)
        : current,
    );
    return item;
  }, []);

  const removeLocalItem = useCallback((itemId: number) => {
    setAllItems((current) => removeItemFromList(current, itemId));
    setCabinetItems((current) => removeItemFromList(current, itemId));
  }, []);

  // 把一批已变更对象并入本地缓存：全量列表直接 upsert；柜内列表只更新已在柜中的
  // 对象（不新增成员——柜的成员关系变化由 add/removeItemsToCabinet 专门维护）。
  const applyChangedItems = useCallback((changedItems: ItemWithTags[]) => {
    if (changedItems.length === 0) return;
    setAllItems((current) => upsertItems(current, changedItems));
    setCabinetItems((current) => {
      const currentIds = new Set(current.map((item) => item.id));
      return upsertItems(
        current,
        changedItems.filter((item) => currentIds.has(item.id)),
      );
    });
  }, []);

  const source = useMemo(() => {
    if (showFavorites) {
      return allItems.filter((item) => item.is_favorite);
    }
    if (showRecent) {
      return allItems.filter((item) => Boolean(item.last_used_at));
    }
    if (selectedCabinetId !== null) {
      // 仅当 cabinetItems 已归属当前选中柜时采用，否则回退空集（等待本柜数据到达），
      // 避免切柜瞬间闪现上一个柜子的内容。
      return cabinetItemsOwner === selectedCabinetId ? cabinetItems : EMPTY_ITEMS;
    }
    return allItems;
  }, [allItems, cabinetItems, cabinetItemsOwner, selectedCabinetId, showFavorites, showRecent]);

  // 标签后代闭包：选中父标签时并入其所有后代标签的对象（图状层级筛选）。
  const descendantsMap = useMemo(() => buildDescendantsMap(tagRelations), [tagRelations]);

  const tagFiltered = useMemo(
    () =>
      filterItemsByTags(source, selectedTagIds, (id) => descendantsMap.get(id) ?? new Set([id]), excludedTagIds),
    [source, selectedTagIds, excludedTagIds, descendantsMap],
  );

  const hasSearchQuery = deferredSearchQuery.trim().length > 0;
  // 浏览和筛选直接使用对象数据；输入搜索词时才构建拼音等派生字段。
  const sourceSearchIndex = useMemo(
    () => hasSearchQuery ? buildSearchIndex(source, searchMode) : null,
    [source, searchMode, hasSearchQuery],
  );

  const tagFilteredIds = useMemo(
    () => new Set(tagFiltered.map((item) => item.id)),
    [tagFiltered],
  );

  const searchIndex = useMemo(
    () => sourceSearchIndex ? filterSearchIndex(sourceSearchIndex, tagFilteredIds) : null,
    [sourceSearchIndex, tagFilteredIds],
  );

  // 排序变更 / 视图域切换 = 显式重排点：渲染期同步重拍冻结排序键，
  // 本帧即按新快照排序（effect 后拍会先按旧快照渲一帧、且不再触发 memo 重算）。
  // 柜内数据未归属当前选中柜时不拍（scopeKey 置 null 跳过），等数据到达的这次渲染
  // 再按新柜数据拍——拿上一柜/空残留做快照会让整个文件柜会话冻结失效。
  // 渲染期写 ref 此处安全：capture 是纯函数、按 key 幂等，被丢弃的渲染留下的
  // 旧 key 会在下一次渲染因不匹配而重拍自愈。
  const cabinetReady = selectedCabinetId === null || cabinetItemsOwner === selectedCabinetId;
  const scopeKey = cabinetReady ? `${sortMode}|${showFavorites}|${showRecent}|${selectedCabinetId}` : null;
  const frozenScopeRef = useRef<string | null>(null);
  if (scopeKey !== null && frozenScopeRef.current !== scopeKey) {
    frozenScopeRef.current = scopeKey;
    frozenSortKeysRef.current = captureFrozenSortKeys(selectedCabinetId !== null ? cabinetItems : allItems);
  }

  const filtered = useMemo(() => {
    if (searchIndex) {
      return applyTypeFilter(searchWithIndex(searchIndex, deferredSearchQuery), typeFilter);
    }
    return applyWorkspaceQuery(tagFiltered, {
      typeFilter,
      sortMode,
      // 冻结键只服务反瞬移场景：显式 recent 排序 / 最近使用域是活视图，启动必须立即升顶
      sortKeyOverrides:
        showRecent || sortMode === "recent"
          ? undefined
          : { lastUsedAt: frozenSortKeysRef.current ?? undefined },
    });
  }, [searchIndex, tagFiltered, deferredSearchQuery, typeFilter, sortMode, showRecent]);

  const addItems = useCallback(async (paths: string[]) => {
    await withErrorToast("批量导入", async () => {
      const result = await db.addItems(paths);
      if (result.failed.length > 0) {
        const first = result.failed[0];
        showToast(`导入失败 ${result.failed.length} 项：${getPathDisplayName(first.path)}（${first.error}）`, "warning");
      }
      if (result.items.length === 0) return;

      // 后端按文件身份判重并标注实际新建数（改名/移动后的重拖会合并既有记录，
      // 不计入新建）——导入反馈以 createdCount 为准，不用路径字符串近似。
      const importedCount = result.createdCount;
      const duplicateCount = result.items.length - importedCount;
      if (importedCount === 0) {
        showToast(`${duplicateCount} 个对象已存在，无需导入`, "info");
      } else if (duplicateCount > 0) {
        showToast(`已导入 ${importedCount} 个对象，${duplicateCount} 个已存在跳过`, "success");
      } else {
        showToast(`已导入 ${importedCount} 个对象`, "success");
      }

      const changedItems = await db.getItemsByIds(result.items.map((item) => item.id), false);
      applyChangedItems(changedItems);

      // 通知新对象已加入（供 AI 自动打标等后台监听）。携带完整对象，
      // 避免监听方读到尚未 flush 的列表状态。
      if (changedItems.length > 0) {
        window.dispatchEvent(
          new CustomEvent("taglauncher-items-added", { detail: { items: changedItems } }),
        );
      }
    });
  }, [applyChangedItems]);

  const removeItem = useCallback(async (id: number) => {
    await withErrorToast("删除项目", async () => {
      await db.removeItem(id);
      removeLocalItem(id);
    });
  }, [removeLocalItem]);

  const removeItems = useCallback(async (ids: number[], options?: { deleteFiles?: boolean }) => {
    if (ids.length === 0) return;

    if (options?.deleteFiles) {
      await withErrorToast("删除本地文件", async () => {
        const result = await db.removeItemsAndFiles(ids);
        const idSet = new Set(result.removedIds);
        setAllItems((current) => current.filter((item) => !idSet.has(item.id)));
        setCabinetItems((current) => current.filter((item) => !idSet.has(item.id)));
        if (result.failed.length > 0) {
          const first = result.failed[0];
          showToast(
            `有 ${result.failed.length} 项未能删除本地文件：${first.error}`,
            "warning",
          );
        } else if (result.removedIds.length > 0) {
          showToast(
            result.removedIds.length === 1 ? "已移到回收站并从库中移除" : `已移到回收站并移除 ${result.removedIds.length} 项`,
            "success",
          );
        }
      });
      return;
    }

    await withErrorToast("从库中移除", async () => {
      await db.removeItems(ids);

      const idSet = new Set(ids);
      setAllItems((current) => current.filter((item) => !idSet.has(item.id)));
      setCabinetItems((current) => current.filter((item) => !idSet.has(item.id)));
    });
  }, []);

  const updateItemIcon = useCallback(async (itemId: number, iconPath: string | null) => {
    await withErrorToast("更新图标", async () => {
      await db.updateItemIcon(itemId, iconPath);
      await refreshItemById(itemId);
    });
  }, [refreshItemById]);

  const setItemTags = useCallback(async (itemId: number, tagIds: number[]) => {
    await withErrorToast("设置标签", async () => {
      await db.setItemTags(itemId, tagIds);
      await refreshItemById(itemId);
    });
  }, [refreshItemById]);

  const setManyItemTags = useCallback(async (changes: Array<{ itemId: number; tagIds: number[] }>) => {
    if (changes.length === 0) return;

    await withErrorToast("批量设置标签", async () => {
      await db.setManyItemTags(changes);

      const changedItems = await db.getItemsByIds(changes.map((change) => change.itemId), false);
      applyChangedItems(changedItems);
    });
  }, [applyChangedItems]);

  const launchItem = useCallback(async (id: number) => {
    try {
      await withErrorToast("启动项目", async () => {
        await db.launchItem(id);
        const item = allItemsRef.current.find((i) => i.id === id);
        if (item) notifyItemLaunched(id, item.name);
      });
      // 启动成功后刷新该项，同步 last_used_at 排序
      void refreshItemById(id).catch(() => {});
    } catch (e) {
      // 启动失败（含"对象已丢失"）：后端可能已将 is_missing 置 1，
      // 刷新该项使失效徽标即时生效，再把错误抛给调用方。
      void refreshItemById(id).catch(() => {});
      throw e;
    }
  }, [refreshItemById]);

  const toggleFavorite = useCallback(async (id: number) => {
    await withErrorToast("切换收藏", async () => {
      await db.toggleFavorite(id);
      await refreshItemById(id);
    });
  }, [refreshItemById]);

  // 批量收藏/取消：后端单事务翻转 + 一次批量回灌，替代逐项 toggle 的串行 IPC
  const setFavorites = useCallback(async (ids: number[], favorite: boolean) => {
    if (ids.length === 0) return;
    await withErrorToast("批量切换收藏", async () => {
      await db.setFavorites(ids, favorite);
      const changedItems = await db.getItemsByIds(ids, false);
      applyChangedItems(changedItems);
    });
  }, [applyChangedItems]);

  // ContextMenu 的多选收藏经由事件到达（右键菜单拿不到本 hook 的回调）
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: unknown; favorite?: unknown }>).detail;
      if (!detail || !Array.isArray(detail.ids)) return;
      const ids = detail.ids.filter((id): id is number => typeof id === "number");
      if (ids.length > 0) void setFavorites(ids, Boolean(detail.favorite)).catch(() => {});
    };
    window.addEventListener(SET_FAVORITES_EVENT, handler);
    return () => window.removeEventListener(SET_FAVORITES_EVENT, handler);
  }, [setFavorites]);

  // 柜成员操作：await 后用 useAppStore.getState() 读最新选中柜（同 useTags 范式），
  // 避免等待期间用户切柜后按调用时刻的捕获值写错 cabinetItems 列表。
  const addItemToCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await withErrorToast("添加到文件柜", async () => {
      await db.addItemToCabinet(cabinetId, itemId);
      if (useAppStore.getState().selectedCabinetId === cabinetId) {
        const item = allItemsRef.current.find((current) => current.id === itemId) ?? await db.getItem(itemId);
        setCabinetItems((current) => upsertItem(current, item));
      }
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, []);

  const addItemsToCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量添加到文件柜", async () => {
      await db.addItemsToCabinet(cabinetId, itemIds);

      if (useAppStore.getState().selectedCabinetId === cabinetId) {
        const changedItems = await db.getItemsByIds(itemIds, false);
        setCabinetItems((current) => upsertItems(current, changedItems));
      }
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, []);

  const removeItemFromCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await withErrorToast("从文件柜移除", async () => {
      await db.removeItemFromCabinet(cabinetId, itemId);
      if (useAppStore.getState().selectedCabinetId === cabinetId) {
        setCabinetItems((current) => removeItemFromList(current, itemId));
      }
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, []);

  const removeItemsFromCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量从文件柜移除", async () => {
      await db.removeItemsFromCabinet(cabinetId, itemIds);

      if (useAppStore.getState().selectedCabinetId === cabinetId) {
        const idSet = new Set(itemIds);
        setCabinetItems((current) => current.filter((item) => !idSet.has(item.id)));
      }
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, []);

  const findItemById = useCallback(
    (itemId: number) =>
      allItemsRef.current.find((item) => item.id === itemId) ??
      cabinetItemsRef.current.find((item) => item.id === itemId),
    [],
  );

  // 手动刷新入口（刷新按钮/命令面板）：用户点刷新 = 图标缓存一并失效重取
  // （前端缓存 + 后端 .none 失败标记双清，瞬时失败不再锁到冷却结束），
  // 且显式触发对账（异步调度，有写入时经 items-reconciled 回来再 loadAll）；
  // 内部级联（标签写、主题换色、监视导入）走 loadAll，不动图标也不对账
  const refresh = useCallback(async (options?: { reconcile?: boolean }) => {
    invalidateItemVisuals();
    void db.clearIconNoneMarkers().catch(() => {});
    if (options?.reconcile) {
      void db.reconcileItems({ force: true }).catch(() => {});
    }
    await loadAll();
  }, [loadAll]);

  return {
    items: filtered,
    allItems,
    loading,
    loadError,
    refresh,
    relocateMissing,
    addItems,
    removeItem,
    removeItems,
    updateItemIcon,
    setItemTags,
    setManyItemTags,
    launchItem,
    toggleFavorite,
    setFavorites,
    addItemToCabinet,
    addItemsToCabinet,
    removeItemFromCabinet,
    removeItemsFromCabinet,
    findItemById,
  };
}
