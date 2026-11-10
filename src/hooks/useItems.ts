import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue, useSyncExternalStore } from "react";
import { autoRelocateFailureNotice } from "../lib/relocateScan";
import { onExternalDataChanged, onWindowDataWritten } from "../lib/dataSync";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { expandForTagFilter } from "../lib/tagFilter";
import { buildDescendantsMap } from "../lib/tagGraph";
import { ItemStore } from "../lib/itemView";
import type { AddItemsContext } from "../lib/db";
import { notifyItemLaunched, notifyItemsChanged, notifyCabinetItemsChanged } from "../lib/modApi";
import { showToast } from "../lib/toast";
import { markSearchResult } from "../lib/searchPerf";
import { latestOnly, SKIPPED } from "../lib/latestOnly";
import { TAGS_WRITTEN_EVENT } from "./useTags";

/** 主题换色后的就地改色事件：detail.tagColors = { tagId: color }。
 *  只改颜色不动结构，无需 TAGS_WRITTEN_EVENT 的全量重取级联。 */
export const ITEM_TAG_COLORS_PATCH_EVENT = "taglauncher-item-tag-colors-patch";
import { invalidateItemVisuals } from "../lib/itemVisualCache";
import type { ItemWithTags } from "../types";

/** 批量收藏请求事件（ContextMenu 多选收藏走此通道，detail: { ids, favorite }）。 */
export const SET_FAVORITES_EVENT = "taglauncher-set-favorites";

/** 单对象刷新请求事件（detail: { id }）：本 hook 之外的写入方（如 ContextMenu 打开所在
 *  文件夹时后端按文件ID重定位并写库）通知本地缓存重新读取该对象。 */
export const ITEM_REFRESH_EVENT = "taglauncher-item-refresh";

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

const EMPTY_IDS: number[] = [];

/**
 * 主窗对象视图（分页）：视图的全部 ID 由后端 view_query 给出（筛选、排序、搜索、目录浏览、
 * 冻结排序键都在 Rust，src-tauri/src/view），对象数据经 ItemStore 按可视区间分页取并有上限缓存。
 * 前端不再持有全量对象：总数 / 全选 / 批量 / 定位基于 ID，需要对象本体时 view.load(ids)。
 */
export function useItems() {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchMode = useAppStore((state) => state.searchMode);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  // 选中柜的关联文件夹：关联 / 解除后成员集合整体改变，需重新查询
  const linkedFolder = useAppStore((state) =>
    state.selectedCabinetId === null
      ? null
      : state.cabinets.find((cabinet) => cabinet.id === state.selectedCabinetId)?.folder_path ?? null,
  );
  const cabinetDir = useAppStore((state) => state.cabinetDir);
  const cabinetFlat = useAppStore((state) => state.cabinetFlat);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const sortMode = useAppStore((state) => state.sortMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const hideMissing = useAppStore((state) => state.hideMissing);
  const showNestedContents = useAppStore((state) => state.showNestedContents);
  const libraryBrowseRoot = useAppStore((state) => state.libraryBrowseRoot);
  const libraryBrowseDir = useAppStore((state) => state.libraryBrowseDir);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const tagList = useAppStore((state) => state.tags);
  const tagFilterMode = useAppStore((state) => state.tagFilterMode);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [store] = useState(() => new ItemStore((ids) => db.getItemsPage(ids), { warm: true }));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // StrictMode 下 useState 初始化会跑两次：统计在挂载后登记，确保指向实际使用的那个实例
  useEffect(() => store.registerPerf(), [store]);
  const [loading, setLoading] = useState(true);
  // 最近一次列表加载失败的可读错误（成功后清空）：供 UI 在库为空时渲染可重试的错误面板
  const [loadError, setLoadError] = useState<string | null>(null);
  // 数据代：任何写入（本应用 / 快速窗 / 外部）后自增，驱动视图重查与计数刷新
  const [dataEpoch, setDataEpoch] = useState(0);
  const bumpData = useCallback(() => setDataEpoch((n) => n + 1), []);
  // 全量刷新代：自增 = 显式重排点（重拍冻结排序键）+ 缓存整体过期
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const reloadWaitersRef = useRef<Array<{ epoch: number; resolve: () => void }>>([]);
  const reloadEpochRef = useRef(0);
  const [viewMeta, setViewMeta] = useState<{ browseDir: string | null; libraryTotal: number; cabinetId: number | null; query: string } | null>(null);
  const [stats, setStats] = useState<db.LibraryStats | null>(null);
  const relocatingRef = useRef<Promise<number> | null>(null);
  const relocateMissingRef = useRef<() => void>(() => {});
  const prevMissingRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    notifyItemsChanged();
  }, [dataEpoch]);

  // 全量刷新：缓存过期 + 重拍冻结键；返回的 Promise 在新视图到达后完成。
  const loadAll = useCallback((): Promise<void> => {
    store.invalidateAll();
    return new Promise<void>((resolve) => {
      reloadEpochRef.current += 1;
      reloadWaitersRef.current.push({ epoch: reloadEpochRef.current, resolve });
      setReloadEpoch(reloadEpochRef.current);
      setDataEpoch((n) => n + 1);
    });
  }, [store]);

  // 跨盘符兜底找回：对失效对象按内容签名扫描候选盘，命中则刷新并提示。
  // 用 relocatingRef 防止并发/重复扫描；成功找回 0 个时保持安静。
  const relocateMissing = useCallback((roots?: string[]): Promise<number> => {
    const scoped = roots !== undefined && roots.length > 0;
    // 全盘找回去重（自动触发与手动点击共用一次扫描）；限定文件夹的找回是用户明确指定的
    // 小范围扫描，不能被在途的全盘扫描吞掉（否则要等全盘扫完、且不是用户要的范围），独立执行。
    if (!scoped && relocatingRef.current) return relocatingRef.current;
    const task = (async () => {
      const recovered = await db.relocateMissing(scoped ? roots : undefined);
      if (recovered > 0) {
        await loadAll();
        showToast(scoped ? `已在选定文件夹中找回 ${recovered} 个对象` : `已跨盘找回 ${recovered} 个对象`, "success");
      }
      return recovered;
    })();
    if (scoped) return task;
    const tracked = task.finally(() => { relocatingRef.current = null; });
    relocatingRef.current = tracked;
    return tracked;
  }, [loadAll]);

  useEffect(() => {
    relocateMissingRef.current = () => {
      void relocateMissing().catch((error: unknown) => {
        // 停止（用户主动）→ 安静说明；超过 5 分钟上限 → 警告并引导限定文件夹；其余才算故障
        const notice = autoRelocateFailureNotice(error);
        if (notice.tone === "error") console.error("跨盘找回失败:", error);
        showToast(notice.message, notice.tone);
      });
    };
  }, [relocateMissing]);

  // ---------------------------------------------------------------- 视图查询
  const descendantsMap = useMemo(() => buildDescendantsMap(tagRelations), [tagRelations]);
  const hasSearchQuery = deferredSearchQuery.trim().length > 0;
  const scope: db.ViewQueryArgs["scope"] = showFavorites ? "favorites" : showRecent ? "recent" : selectedCabinetId !== null ? "cabinet" : "all";
  const viewArgs = useMemo((): Omit<db.ViewQueryArgs, "refreeze"> => {
    const expand = expandForTagFilter(tagFilterMode !== "direct", descendantsMap);
    const group = (id: number) => (expand ? [...expand(id)] : [id]);
    return {
      scope,
      cabinetId: scope === "cabinet" ? selectedCabinetId : null,
      selectedGroups: selectedTagIds.map(group),
      excludedGroups: excludedTagIds.map(group),
      typeFilter,
      hideMissing,
      sortMode,
      showNestedContents,
      libraryBrowseRoot,
      libraryBrowseDir,
      cabinetDir: linkedFolder !== null ? cabinetDir : null,
      cabinetFlat,
      query: hasSearchQuery ? deferredSearchQuery : "",
      mode: searchMode,
    };
    // linkedFolder：关联/解除后柜成员整体变化，需重查
  }, [scope, selectedCabinetId, selectedTagIds, excludedTagIds, tagFilterMode, descendantsMap, typeFilter, hideMissing, sortMode, showNestedContents, libraryBrowseRoot, libraryBrowseDir, linkedFolder, cabinetDir, cabinetFlat, hasSearchQuery, deferredSearchQuery, searchMode]);
  const viewArgsRef = useRef(viewArgs);
  useEffect(() => {
    viewArgsRef.current = viewArgs;
  }, [viewArgs]);
  /** 视图内名称跳转（typeahead）：后端在同一组视图参数下找，不重拍冻结键 */
  const typeahead = useCallback(
    (text: string) => db.viewTypeahead({ ...viewArgsRef.current, refreeze: false }, text),
    [],
  );
  // 排序变更 / 视图域切换 / 全量刷新 = 显式重排点：重拍 smart 排序的冻结键
  const scopeKey = `${sortMode}|${showFavorites}|${showRecent}|${selectedCabinetId}|${reloadEpoch}`;
  const queriedScopeRef = useRef<string | null>(null);
  // 重拍请求要「粘住」直到某次带重拍的查询真正完成（被 latestOnly 跳过的那次不算）
  const pendingRefreezeRef = useRef(false);
  const viewSeqRef = useRef(0);
  // 同一时刻只一个查询在途，期间的新参数只保留最后一次（后端索引锁串行，避免慢机排队）
  const [runView] = useState(() => latestOnly((args: db.ViewQueryArgs) => db.viewQuery(args)));
  useEffect(() => {
    const seq = ++viewSeqRef.current;
    if (queriedScopeRef.current !== scopeKey) pendingRefreezeRef.current = true;
    queriedScopeRef.current = scopeKey;
    const args = { ...viewArgs, refreeze: pendingRefreezeRef.current };
    const epoch = reloadEpoch;
    const settle = () => {
      const waiters = reloadWaitersRef.current;
      reloadWaitersRef.current = waiters.filter((w) => w.epoch > epoch);
      for (const w of waiters) if (w.epoch <= epoch) w.resolve();
    };
    runView(args)
      .then((res) => {
        if (res === SKIPPED) return;
        if (args.refreeze) pendingRefreezeRef.current = false;
        settle();
        if (seq !== viewSeqRef.current) return;
        store.setIds(res.ids);
        setViewMeta({ browseDir: res.browseDir, libraryTotal: res.libraryTotal, cabinetId: args.cabinetId ?? null, query: args.query });
        setLoadError(null);
        if (args.query) markSearchResult(args.query, res.ids.length);
      })
      .catch((error: unknown) => {
        settle();
        if (seq !== viewSeqRef.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        console.error(args.query ? "搜索失败:" : "Failed to load items:", error);
        setLoadError(detail);
        showToast(args.query ? `搜索失败：${detail}` : `加载对象列表失败：${detail}`, "error");
      })
      .finally(() => {
        if (seq === viewSeqRef.current) setLoading(false);
      });
  }, [viewArgs, scopeKey, reloadEpoch, dataEpoch, runView, store]);

  // 侧栏标签计数与单击筛选同一口径：父标签并入后代
  const tagGroups = useMemo(
    (): [number, number[]][] => tagList.map((tag) => [tag.id, [...(descendantsMap.get(tag.id) ?? new Set([tag.id]))]]),
    [tagList, descendantsMap],
  );
  // 首屏后预建搜索索引已由 view_query 完成（同一索引）；计数与失效提示
  useEffect(() => {
    let cancelled = false;
    void db.libraryStats(tagGroups)
      .then(async (next) => {
        if (cancelled) return;
        setStats(next);
        const prev = prevMissingRef.current;
        const now = new Set(next.missingIds);
        prevMissingRef.current = now;
        if (prev === null) return;
        const newly = next.missingIds.filter((id) => !prev.has(id));
        if (newly.length === 0) return;
        const names = (await store.load(newly.slice(0, 3))).map((item) => item.name).join("、");
        const suffix = newly.length > 3 ? ` 等 ${newly.length} 个` : "";
        showToast(
          `${newly.length} 个对象的文件已丢失或移动到其他磁盘：${names}${suffix}（归类已保留，文件恢复后会自动重新关联）`,
          "warning",
        );
        // 兜底：后台按内容签名尝试跨盘找回（扫描在后端 DB 锁外执行，不阻塞）。
        relocateMissingRef.current();
      })
      .catch((error: unknown) => console.error("读取库计数失败:", error));
    return () => {
      cancelled = true;
    };
  }, [dataEpoch, store, tagGroups]);

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

  // 外部进程（tl CLI 等）写库：后端 data_version 检测到后广播
  useEffect(() => onExternalDataChanged(() => { void loadAll(); }), [loadAll]);

  // 对账解耦：后台对账有实际写入时同步失效标记与重定位结果
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

  // 标签改名/删除后，对象卡片上的标签 pill 渲染自 item.tags：全量刷新，避免残留幽灵标签
  useEffect(() => {
    const handler = () => { void loadAll(); };
    window.addEventListener(TAGS_WRITTEN_EVENT, handler);
    return () => window.removeEventListener(TAGS_WRITTEN_EVENT, handler);
  }, [loadAll]);

  // 主题换色（色位写回）只变 color：按 tag id 就地更新已缓存对象的内嵌标签色，不重取
  useEffect(() => {
    const handler = (event: Event) => {
      const tagColors = (event as CustomEvent<{ tagColors?: Record<number, string> }>).detail?.tagColors;
      if (!tagColors) return;
      store.patch((item) => {
        if (!item.tags.some((tag) => tagColors[tag.id] !== undefined)) return item;
        return {
          ...item,
          tags: item.tags.map((tag) => (tagColors[tag.id] !== undefined ? { ...tag, color: tagColors[tag.id] } : tag)),
        };
      });
    };
    window.addEventListener(ITEM_TAG_COLORS_PATCH_EVENT, handler);
    return () => window.removeEventListener(ITEM_TAG_COLORS_PATCH_EVENT, handler);
  }, [store]);

  // 把一批已变更对象并入缓存并重查视图（收藏/最近使用/标签变化可能改变归属与顺序）
  const applyChangedItems = useCallback((changedItems: ItemWithTags[]) => {
    if (changedItems.length === 0) return;
    store.upsert(changedItems);
    bumpData();
  }, [store, bumpData]);

  const refreshItemById = useCallback(async (itemId: number) => {
    const item = await db.getItem(itemId);
    applyChangedItems([item]);
    return item;
  }, [applyChangedItems]);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id !== "number") return;
      void refreshItemById(id).catch((error: unknown) => console.error("刷新对象失败:", error));
    };
    window.addEventListener(ITEM_REFRESH_EVENT, handler);
    return () => window.removeEventListener(ITEM_REFRESH_EVENT, handler);
  }, [refreshItemById]);

  const removeLocalItems = useCallback((ids: number[]) => {
    store.remove(ids);
    bumpData();
  }, [store, bumpData]);

  // 快速搜索窗写库（打标签、启动刷新最近使用）后按对象 ID 增量刷新，不全量重载
  useEffect(() => onWindowDataWritten("main", ({ itemIds }) => {
    if (itemIds.length === 0) return;
    void db.getItemsByIds(itemIds, false)
      .then(applyChangedItems)
      .catch((error: unknown) => console.error("增量刷新对象失败:", error));
  }), [applyChangedItems]);

  const browseDir = viewMeta?.browseDir ?? null;
  const cabinetReady = scope !== "cabinet" || viewMeta?.cabinetId === selectedCabinetId;

  // 关联柜内的失效对象（「清理失效」用）：取整个关联文件夹，不受当前目录与筛选影响
  const [linkedMissingIds, setLinkedMissingIds] = useState<number[]>(EMPTY_IDS);
  useEffect(() => {
    if (linkedFolder === null || selectedCabinetId === null || !stats || stats.missingIds.length === 0) {
      setLinkedMissingIds(EMPTY_IDS);
      return;
    }
    let cancelled = false;
    const missing = new Set(stats.missingIds);
    void db.viewQuery({
      scope: "cabinet", cabinetId: selectedCabinetId, selectedGroups: [], excludedGroups: [], typeFilter: "all",
      hideMissing: false, sortMode: "smart", showNestedContents: true, libraryBrowseRoot: null, libraryBrowseDir: null,
      cabinetDir: null, cabinetFlat: true, query: "", mode: "all", refreeze: false,
    })
      .then((res) => {
        if (!cancelled) setLinkedMissingIds(res.ids.filter((id) => missing.has(id)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [linkedFolder, selectedCabinetId, stats]);

  const addItems = useCallback(async (paths: string[], context?: AddItemsContext) => {
    await withErrorToast("批量导入", async () => {
      const result = await db.addItems(paths, context);
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
      const cabinetId = context?.cabinetId;
      if (cabinetId != null) {
        notifyCabinetItemsChanged(cabinetId, changedItems.map((item) => item.id));
      }

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
      removeLocalItems([id]);
    });
  }, [removeLocalItems]);

  const removeItems = useCallback(async (ids: number[], options?: { deleteFiles?: boolean }) => {
    if (ids.length === 0) return;

    if (options?.deleteFiles) {
      await withErrorToast("删除本地文件", async () => {
        const result = await db.removeItemsAndFiles(ids);
        removeLocalItems(result.removedIds);
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

      removeLocalItems(ids);
    });
  }, [removeLocalItems]);

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
        const item = store.getSnapshot().get(id);
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

  const setItemNote = useCallback(async (id: number, note: string) => {
    await withErrorToast("保存备注", async () => {
      await db.setItemNote(id, note);
      await refreshItemById(id);
    });
  }, [refreshItemById]);

  const setItemAlias = useCallback(async (id: number, alias: string) => {
    await withErrorToast("保存别名", async () => {
      await db.setItemAlias(id, alias);
      await refreshItemById(id);
    });
  }, [refreshItemById]);

  // 文件夹改名会同步改写库内子对象路径，成功后整体重载
  const renameItem = useCallback(async (id: number, newName: string) => {
    await withErrorToast("重命名", async () => {
      const report = await db.renameItems([{ id, newName }], false);
      const failure = report.failed[0];
      if (failure) throw new Error(failure.error);
      if (report.renamed.length > 0) await loadAll();
    });
  }, [loadAll]);

  /** 批量重命名：逐项执行，返回成功与失败明细；有成功项时重新加载。 */
  const batchRename = useCallback(async (renames: db.RenameRequest[]) => {
    return withErrorToast("批量重命名", async () => {
      const report = await db.renameItems(renames, false);
      if (report.renamed.length > 0) await loadAll();
      return report;
    });
  }, [loadAll]);

  /** 撤销最近一次批量重命名：把成功项改回原名；未能改回的项保留在撤销记录里，可再次撤销。 */
  const undoBatchRename = useCallback(async () => {
    const { lastBatchRename, setLastBatchRename } = useAppStore.getState();
    if (!lastBatchRename) return;
    const report = await batchRename(lastBatchRename.map(({ id, oldName }) => ({ id, newName: oldName })));
    const failedIds = new Set(report.failed.map((failure) => failure.id));
    setLastBatchRename(lastBatchRename.filter((entry) => failedIds.has(entry.id)));
    if (report.failed.length === 0) showToast(`已撤销批量重命名（${report.renamed.length} 项）`, "success");
    else showToast(`撤销完成 ${report.renamed.length} 项，${report.failed.length} 项未能改回：${report.failed[0].error}`, "warning");
  }, [batchRename]);

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
      bumpData();
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, [bumpData]);

  const addItemsToCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量添加到文件柜", async () => {
      await db.addItemsToCabinet(cabinetId, itemIds);
      bumpData();
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, [bumpData]);

  const removeItemFromCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await withErrorToast("从文件柜移除", async () => {
      await db.removeItemFromCabinet(cabinetId, itemId);
      bumpData();
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, [bumpData]);

  const removeItemsFromCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量从文件柜移除", async () => {
      await db.removeItemsFromCabinet(cabinetId, itemIds);
      bumpData();
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, [bumpData]);

  // 缓存内查找（同步）；不在缓存里的对象用 view.load / loadItems 异步取
  const findItemById = useCallback((itemId: number) => store.getSnapshot().get(itemId), [store]);
  const loadItems = useCallback((ids: readonly number[]) => store.load(ids), [store]);

  // 手动刷新入口（刷新按钮/命令面板）：用户点刷新 = 图标缓存一并失效重取
  // （前端缓存 + 后端 .none 失败标记双清，瞬时失败不再锁到冷却结束），
  // 且显式触发对账（异步调度，有写入时经 items-reconciled 回来再 loadAll）；
  // 内部级联（标签写、主题换色、监视导入）走 loadAll，不动图标也不对账
  const refresh = useCallback(async (options?: { reconcile?: boolean }) => {
    invalidateItemVisuals();
    void db.clearIconNoneMarkers().catch(() => {});
    if (options?.reconcile) {
      void db.reconcileItems({ force: true }).catch(() => {
        showToast("对账失败", "error");
      });
    }
    await loadAll();
  }, [loadAll]);

  // 清空最近使用时间后整库重取：默认排序随之变化
  const clearRecent = useCallback(async () => {
    await withErrorToast("清除最近使用", async () => {
      const count = await db.clearRecentItems();
      await refresh();
      showToast(count > 0 ? `已清除 ${count} 项最近使用记录` : "没有最近使用记录", "success");
    });
  }, [refresh]);

  return {
    view,
    /** 库内对象总数（空库判定） */
    libraryTotal: viewMeta?.libraryTotal ?? 0,
    stats,
    dataEpoch,
    loadItems,
    typeahead,
    loading,
    browseDir,
    linkedMissingIds,
    cabinetPending: !cabinetReady,
    loadError,
    refresh,
    relocateMissing,
    addItems,
    removeItem,
    removeItems,
    updateItemIcon,
    setItemTags,
    setManyItemTags,
    setItemNote,
    setItemAlias,
    renameItem,
    batchRename,
    undoBatchRename,
    launchItem,
    toggleFavorite,
    setFavorites,
    clearRecent,
    addItemToCabinet,
    addItemsToCabinet,
    removeItemFromCabinet,
    removeItemsFromCabinet,
    findItemById,
  };
}
