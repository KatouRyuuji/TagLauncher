// ============================================================================
// quick/QuickApp.tsx — 全局快速搜索窗
// ============================================================================
// 预创建、隐藏常驻：数据在隐藏期间就加载好并建好搜索索引，唤出时只做聚焦。
// 键位：↑↓ 选择 · Enter 打开 · Ctrl+Enter 显示位置 · Ctrl+Shift+C 复制路径 ·
//       Alt+Enter 在主窗定位 · Ctrl+T 打标签 · Esc 先清空再收起。
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { announceWindowWrite, onAnyDataChanged } from "../lib/dataSync";
import { ensurePinyin } from "../lib/pinyinProvider";
import { formatPathCopy } from "../lib/itemQuery";
import { itemDisplayName } from "../lib/itemDisplay";
import { loadWorkspacePrefs, PREFS_KEY, type SearchMode } from "../stores/appStore";
import { applyThemeSnapshot, parseThemeSnapshot, THEME_SNAPSHOT_KEY } from "../lib/themeSnapshot";
import type { ItemWithTags, Tag } from "../types";
import {
  buildQuickData,
  filterTagChoices,
  quickKeyAction,
  quickResults,
  stepIndex,
  toggledTagIds,
  type QuickData,
} from "./quickModel";
import { recordQuickLoad, recordQuickQuery, recordQuickSummon } from "./quickPerf";

export const QUICK_SHOWN_EVENT = "quick-shown";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readPrefs(): { searchMode: SearchMode; hideMissing: boolean } {
  const prefs = loadWorkspacePrefs();
  return { searchMode: prefs.searchMode ?? "all", hideMissing: prefs.hideMissing ?? false };
}

function useThemeFollower() {
  useEffect(() => {
    const apply = (raw: string | null) => {
      const snapshot = parseThemeSnapshot(raw);
      if (snapshot) applyThemeSnapshot(snapshot);
    };
    apply(localStorage.getItem(THEME_SNAPSHOT_KEY));
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_SNAPSHOT_KEY) apply(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

interface TagPickerState {
  item: ItemWithTags;
  filter: string;
  index: number;
  activeIds: Set<number>;
  tags: Tag[];
}

export function QuickApp() {
  useThemeFollower();
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const [items, setItems] = useState<ItemWithTags[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [picker, setPicker] = useState<TagPickerState | null>(null);
  const pendingQueryStart = useRef<{ q: string; start: number } | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const reloadAgain = useRef(false);

  // 数据：只读连接取全部对象；拼音词典先就绪再建索引（与主窗同一索引代码）
  const load = useCallback((): Promise<void> => {
    if (loading.current) {
      reloadAgain.current = true;
      return loading.current;
    }
    const started = performance.now();
    loading.current = Promise.all([ensurePinyin(), db.quickGetItems()])
      .then(([, next]) => {
        setItems(next);
        recordQuickLoad(next.length, performance.now() - started);
      })
      .catch((e: unknown) => setStatus({ text: `读取对象失败：${errorText(e)}`, tone: "error" }))
      .finally(() => {
        loading.current = null;
        if (reloadAgain.current) {
          reloadAgain.current = false;
          void load();
        }
      });
    return loading.current;
  }, []);

  useEffect(() => {
    void load();
    // 任何来源的写入（主窗、tl CLI、本窗口）都重新加载：隐藏期间也做，唤出时即是最新
    return onAnyDataChanged(() => { void load(); });
  }, [load]);

  // 主窗改了搜索范围 / 隐藏丢失对象的偏好
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(readPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const data: QuickData | null = useMemo(
    () => (items ? buildQuickData(items, prefs.searchMode) : null),
    [items, prefs.searchMode],
  );
  const results = useMemo(
    () => (data ? quickResults(data, query, { hideMissing: prefs.hideMissing }) : []),
    [data, query, prefs.hideMissing],
  );
  const current = results[Math.min(selected, results.length - 1)] ?? null;

  // 「输入到出结果」：输入事件时刻 → 结果提交后的下一帧
  useLayoutEffect(() => {
    const pending = pendingQueryStart.current;
    if (!pending || pending.q !== query) return;
    pendingQueryStart.current = null;
    requestAnimationFrame(() => recordQuickQuery(query, results.length, performance.now() - pending.start, items?.length ?? 0));
  }, [query, results, items]);

  // 唤出：聚焦并全选上次的输入（直接打字即替换）
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ t0Ms?: number }>(QUICK_SHOWN_EVENT, (event) => {
      setPicker(null);
      setStatus(null);
      setPrefs(readPrefs());
      const input = inputRef.current;
      input?.focus();
      input?.select();
      const t0 = typeof event.payload?.t0Ms === "number" ? event.payload.t0Ms : Date.now();
      requestAnimationFrame(() => recordQuickSummon(t0, Date.now(), document.activeElement === inputRef.current));
    })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (picker) tagInputRef.current?.focus();
    else inputRef.current?.focus();
  }, [picker]);

  const hide = useCallback(() => {
    void db.quickHide().catch(() => {});
  }, []);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      setStatus({ text: `${label}失败：${errorText(e)}`, tone: "error" });
    }
  }, []);

  const openTagPicker = useCallback(async (item: ItemWithTags) => {
    await run("读取标签", async () => {
      const tags = await db.getTags();
      setPicker({ item, filter: "", index: 0, activeIds: new Set(item.tags.map((t) => t.id)), tags });
    });
  }, [run]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const action = quickKeyAction(event);
    if (!action) return;
    if (action === "escape") {
      event.preventDefault();
      if (query) setQuery("");
      else hide();
      return;
    }
    if (action === "up" || action === "down") {
      event.preventDefault();
      setSelected((i) => stepIndex(results.length, Math.min(i, results.length - 1), action === "down" ? 1 : -1));
      return;
    }
    if (!current) return;
    event.preventDefault();
    const id = current.id;
    switch (action) {
      case "launch":
        void run("打开", async () => {
          await db.launchItem(id);
          announceWindowWrite({ source: "quick", itemIds: [id], tagsChanged: false });
          hide();
        });
        break;
      case "reveal":
        void run("显示位置", async () => {
          await db.openInExplorerById(id);
          hide();
        });
        break;
      case "copy": {
        const payload = formatPathCopy([current.path]);
        if (!payload) return;
        void run("复制", async () => {
          await navigator.clipboard.writeText(payload.text);
          setStatus({ text: payload.message, tone: "info" });
        });
        break;
      }
      case "locate":
        void run("在主窗定位", () => db.quickLocateInMain(id));
        break;
      case "tag":
        void openTagPicker(current);
        break;
    }
  };

  const choices = picker ? filterTagChoices(picker.tags, picker.filter, picker.activeIds) : [];

  const onTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!picker) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPicker(null);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setPicker({ ...picker, index: stepIndex(choices.length, picker.index, event.key === "ArrowDown" ? 1 : -1) });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const tag = choices[Math.min(picker.index, choices.length - 1)];
    if (!tag) return;
    const target = { tags: picker.tags.filter((t) => picker.activeIds.has(t.id)) };
    const nextIds = toggledTagIds(target, tag.id);
    void run("打标签", async () => {
      await db.setItemTags(picker.item.id, nextIds);
      announceWindowWrite({ source: "quick", itemIds: [picker.item.id], tagsChanged: false });
      const added = nextIds.includes(tag.id);
      setPicker((p) => (p ? { ...p, activeIds: new Set(nextIds) } : p));
      setStatus({ text: `${added ? "已添加" : "已移除"}标签「${tag.name}」`, tone: "info" });
    });
  };

  return (
    <div className="quick-shell" data-testid="quick-root">
      <input
        ref={inputRef}
        data-testid="quick-input"
        className="quick-input"
        aria-label="快速搜索"
        placeholder={items ? `搜索 ${items.length} 个对象…` : "正在加载…"}
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          pendingQueryStart.current = { q: event.target.value, start: event.timeStamp };
          setQuery(event.target.value);
          setSelected(0);
          setStatus(null);
        }}
        onKeyDown={onKeyDown}
      />
      {picker ? (
        <div className="quick-picker" data-testid="quick-tag-picker">
          <div className="quick-picker-title">给「{itemDisplayName(picker.item)}」打标签（Enter 切换，Esc 返回）</div>
          <input
            ref={tagInputRef}
            data-testid="quick-tag-input"
            className="quick-input quick-input-small"
            aria-label="筛选标签"
            placeholder="筛选标签…"
            value={picker.filter}
            onChange={(e) => setPicker({ ...picker, filter: e.target.value, index: 0 })}
            onKeyDown={onTagKeyDown}
          />
          <ul role="listbox" aria-label="标签" className="quick-list">
            {choices.length === 0 && <li className="quick-empty">没有匹配的标签（新建标签请在主窗口操作）</li>}
            {choices.slice(0, 50).map((tag, i) => (
              <li
                key={tag.id}
                role="option"
                aria-selected={i === picker.index}
                aria-checked={picker.activeIds.has(tag.id)}
                data-testid="quick-tag-option"
                className="quick-row"
              >
                <span className="quick-check">{picker.activeIds.has(tag.id) ? "✓" : ""}</span>
                <span className="quick-tag-dot" style={{ background: tag.color }} />
                <span className="quick-name">{tag.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul role="listbox" aria-label="搜索结果" className="quick-list" data-testid="quick-results">
          {data && results.length === 0 && <li className="quick-empty">没有匹配的对象</li>}
          {results.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={item === current}
              data-testid="quick-result"
              data-item-id={item.id}
              className={`quick-row${item.is_missing ? " quick-missing" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => e.preventDefault()}
              onDoubleClick={() => void run("打开", async () => {
                await db.launchItem(item.id);
                announceWindowWrite({ source: "quick", itemIds: [item.id], tagsChanged: false });
                hide();
              })}
            >
              <span className="quick-name">{itemDisplayName(item)}</span>
              {item.tags.length > 0 && (
                <span className="quick-tags">{item.tags.slice(0, 3).map((t) => t.name).join(" · ")}</span>
              )}
              <span className="quick-path">{item.path}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="quick-footer">
        {status ? (
          <span role={status.tone === "error" ? "alert" : "status"} data-testid="quick-status" className={status.tone === "error" ? "quick-error" : ""}>
            {status.text}
          </span>
        ) : (
          <span>Enter 打开 · Ctrl+Enter 位置 · Ctrl+Shift+C 复制路径 · Alt+Enter 主窗定位 · Ctrl+T 标签 · Esc 收起</span>
        )}
      </div>
    </div>
  );
}
