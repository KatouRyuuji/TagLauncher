// ============================================================================
// quick/QuickApp.tsx — 全局快速搜索窗
// ============================================================================
// 预创建、隐藏常驻：不加载全量对象，每次输入向后端 quick_search 取前 50 条
// （与主窗同一个 Rust 内存索引，见 src-tauri/src/search）；唤出时只做聚焦。
// 键位：↑↓ 选择 · Enter 打开 · Ctrl+Enter 显示位置 · Ctrl+Shift+C 复制路径 ·
//       Alt+Enter 在主窗定位 · Ctrl+T 打标签 · Esc 先清空再收起。
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as db from "../lib/db";
import { latestOnly, SKIPPED } from "../lib/latestOnly";
import { announceWindowWrite, onAnyDataChanged } from "../lib/dataSync";
import { formatPathCopy } from "../lib/itemQuery";
import { itemDisplayName } from "../lib/itemDisplay";
import { loadWorkspacePrefs, PREFS_KEY, type SearchMode } from "../stores/appStore";
import { applyThemeSnapshot, parseThemeSnapshot, THEME_SNAPSHOT_KEY } from "../lib/themeSnapshot";
import type { ItemWithTags, Tag } from "../types";
import { filterTagChoices, QUICK_RESULT_LIMIT, quickKeyAction, stepIndex, toggledTagIds } from "./quickModel";
import { recordQuickLoad, recordQuickMemory, recordQuickQuery, recordQuickSummon } from "./quickPerf";
import { QUICK_COLLECT_EVENT, type CollectSession } from "../lib/collect";
import { QuickCollect } from "./QuickCollect";
import { ItemTypeIcon, ItemVisualIcon } from "../components/ItemVisualIcon";
import type { PinViewState } from "../lib/desktopShortcut";
import { PinView } from "./PinView";

export const QUICK_SHOWN_EVENT = "quick-shown";
/** 只给前 N 条取缩略图/程序图标（§3.3 数据投影），其余行只画类型图标，不发 IPC */
export const QUICK_ICON_LIMIT = 20;
/** 后端切换 WebView2 内存目标后发来（只做记录，供 E2E 断言） */
export const QUICK_MEMORY_EVENT = "quick-memory-level";

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
      if (snapshot) {
        applyThemeSnapshot(snapshot);
        return;
      }
      // 主窗还没写过快照（极少见：首启即被右键菜单拉起）：套默认主题令牌，不让样式落到浏览器默认色
      void import("../themes/tokens").then(({ DEFAULT_THEME_VARIABLES }) => {
        if (localStorage.getItem(THEME_SNAPSHOT_KEY)) return;
        const vars = Object.fromEntries(Object.entries(DEFAULT_THEME_VARIABLES).map(([k, v]) => [`--${k}`, v]));
        applyThemeSnapshot({ vars, attrs: {} });
      });
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

/** 收纳会话：窗口刚创建时可能错过事件，挂载时先拉一次；之后按 quick-collect 事件更新 */
function useCollectSession(): [CollectSession | null, (id: number) => void] {
  const [session, setSession] = useState<CollectSession | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void db.collectSession().then((s) => { if (!disposed && s) setSession(s); }).catch(() => {});
    void listen<CollectSession>(QUICK_COLLECT_EVENT, (event) => setSession(event.payload))
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
  // 只清掉已结束的那个会话：collect_finish 有剩余路径时会先推来新会话，不能被随后的关闭覆盖
  return [session, useCallback((id: number) => setSession((s) => (s && s.id === id ? null : s)), [])];
}

/**
 * 拖入快速窗即收纳（搜索态开始新会话，收纳态并入当前会话）。只听 webview 级原生拖放事件：
 * 快速窗只有一个 webview，窗口级事件是同一份。返回拖动中的项数（null = 没有拖动）与收纳失败信息。
 */
function useQuickDrop(): { dragging: number | null; dropError: string | null } {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") {
          setDropError(null);
          setDragging(p.paths.length);
        } else if (p.type === "over") {
          setDragging((n) => n ?? 0);
        } else if (p.type === "leave") {
          setDragging(null);
        } else if (p.type === "drop") {
          setDragging(null);
          if (p.paths.length === 0) return;
          void db.collectSubmit(p.paths).catch((e: unknown) => setDropError(errorText(e)));
        }
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
  return { dragging, dropError };
}

/** 后端 pin-surface 事件：quick 窗口当前是搜索表面还是钉住视图表面 */
export const PIN_SURFACE_EVENT = "pin-surface";

/** 切换表面：同步写 html[data-surface]（CSS 据此显示 / 隐藏两套界面，不卸载组件，切回搜索可立即聚焦） */
export function setSurface(surface: "search" | "pin"): void {
  document.documentElement.dataset.surface = surface;
}

/** 钉住视图状态：挂载时先拉一次（窗口创建时可能错过事件），之后跟 pin-surface 事件 */
function usePinView(): PinViewState | null {
  const [view, setView] = useState<PinViewState | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const apply = (v: PinViewState) => {
      setSurface(v.surface);
      setView(v);
    };
    void listen<PinViewState>(PIN_SURFACE_EVENT, (event) => apply(event.payload))
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => {});
    void db.pinState().then((v) => { if (!disposed) apply(v); }).catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return view;
}

export function QuickApp() {
  const [collect, closeCollect] = useCollectSession();
  const { dragging, dropError } = useQuickDrop();
  const pin = usePinView();
  // 搜索预热（空查询 → 后端建索引 + 渲染结果行）推迟到搜索表面第一次出现：
  // 只开钉住视图时不为用不到的搜索常驻内存。一旦用过搜索就保持预热。
  const [searchArmed, setSearchArmed] = useState(false);
  useEffect(() => {
    if (pin && pin.surface === "search") setSearchArmed(true);
  }, [pin]);
  return (
    <>
      {pin && pin.settings.enabled && pin.settings.source && <PinView view={pin} />}
      {collect ? <QuickCollectShell session={collect} onClose={closeCollect} /> : <QuickSearch dropError={dropError} armed={searchArmed} />}
      {dragging !== null && (
        <div className="quick-drop-overlay" data-testid="quick-drop-overlay">
          {dragging > 0 ? `松开即收纳 ${dragging} 项` : "松开即收纳"}
        </div>
      )}
    </>
  );
}

function QuickCollectShell({ session, onClose }: { session: CollectSession; onClose: (id: number) => void }) {
  useThemeFollower();
  // 同一会话的更新（新路径并入）沿用组件状态；换会话时重建
  return <QuickCollect key={session.id} session={session} onClose={() => onClose(session.id)} />;
}

/** 剪贴板里有文件（或存在的路径）时提示收纳：唤出时读一次，收纳后清掉提示 */
function useClipboardCandidates(): [string[], () => void] {
  const [paths, setPaths] = useState<string[]>([]);
  const refresh = useCallback(() => {
    void db.clipboardCollectCandidates().then(setPaths, () => setPaths([]));
  }, []);
  useEffect(() => {
    refresh();
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen(QUICK_SHOWN_EVENT, refresh)
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [refresh]);
  return [paths, useCallback(() => setPaths([]), [])];
}

function QuickSearch({ dropError, armed: armedByApp }: { dropError: string | null; armed: boolean }) {
  useThemeFollower();
  const [clipboardPaths, clearClipboardPaths] = useClipboardCandidates();
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const [res, setRes] = useState<{ query: string; total: number; indexed: number; items: ItemWithTags[] } | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [picker, setPicker] = useState<TagPickerState | null>(null);
  const pendingQueryStart = useRef<{ q: string; start: number } | null>(null);
  const searchSeq = useRef(0);
  // 同一时刻只一个搜索在途，打字期间只保留最后一个词（后端索引锁串行，避免慢机排队）
  const [runQuickSearch] = useState(() => latestOnly((args: Parameters<typeof db.quickSearch>[0]) => db.quickSearch(args)));
  // 数据版本：任何来源的写入（主窗、tl CLI、本窗口）都重查当前词，隐藏期间也做，唤出时即是最新
  const [dataTick, setDataTick] = useState(0);
  useEffect(() => onAnyDataChanged(() => setDataTick((t) => t + 1)), []);

  // 主窗改了搜索范围 / 隐藏丢失对象的偏好
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(readPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 唤出事件也会武装（事件可能先于 pin-surface 到达）
  const [shown, setShown] = useState(false);
  const armed = armedByApp || shown;
  useEffect(() => {
    if (!armed) return;
    const seq = ++searchSeq.current;
    const started = performance.now();
    runQuickSearch({ query, mode: prefs.searchMode, hideMissing: prefs.hideMissing, limit: QUICK_RESULT_LIMIT })
      .then((r) => {
        if (r === SKIPPED || seq !== searchSeq.current) return;
        setRes({ query, total: r.total, indexed: r.indexed, items: r.items });
        // 「加载」= 空查询结果就绪（含后端首次建索引），E2E 据此等待预热完成
        if (!query.trim()) recordQuickLoad(r.indexed, performance.now() - started);
      })
      .catch((e: unknown) => {
        if (seq === searchSeq.current) setStatus({ text: `搜索失败：${errorText(e)}`, tone: "error" });
      });
  }, [armed, query, prefs.searchMode, prefs.hideMissing, dataTick]);
  // 新词的结果到达前沿用上一次结果，避免列表闪空
  const results = res?.items ?? [];
  const current = results[Math.min(selected, results.length - 1)] ?? null;

  // 「输入到出结果」：输入事件时刻 → 结果提交后的下一帧
  useLayoutEffect(() => {
    const pending = pendingQueryStart.current;
    if (!pending || !res || pending.q !== res.query) return;
    pendingQueryStart.current = null;
    const { query: q, total, indexed } = res;
    requestAnimationFrame(() => recordQuickQuery(q, total, performance.now() - pending.start, indexed));
  }, [res]);

  // 唤出：聚焦并全选上次的输入（直接打字即替换）；选项「保留上次输入」关闭时清空
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ t0Ms?: number; keepInput?: boolean }>(QUICK_SHOWN_EVENT, (event) => {
      // 唤出快速搜索：先切到搜索表面（钉住视图共用本窗口），否则输入框在 display:none 里聚焦不了
      setSurface("search");
      setShown(true);
      setPicker(null);
      setStatus(null);
      setPrefs(readPrefs());
      if (event.payload?.keepInput === false) {
        setQuery("");
        setSelected(0);
      }
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
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ level?: string; atMs?: number }>(QUICK_MEMORY_EVENT, (event) => {
      recordQuickMemory(String(event.payload?.level ?? ""), event.payload?.atMs ?? Date.now());
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

  const collectClipboard = useCallback(() => {
    if (clipboardPaths.length === 0) return;
    const paths = clipboardPaths;
    clearClipboardPaths();
    void run("收纳剪贴板", async () => {
      await db.collectSubmit(paths);
    });
  }, [clipboardPaths, clearClipboardPaths, run]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "v" && clipboardPaths.length > 0) {
      event.preventDefault();
      collectClipboard();
      return;
    }
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
        placeholder={res ? `搜索 ${res.indexed} 个对象…` : "正在加载…"}
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
      {clipboardPaths.length > 0 && !picker && (
        <button type="button" className="quick-button quick-clipboard" data-testid="quick-clipboard" data-count={clipboardPaths.length} onMouseDown={(e) => e.preventDefault()} onClick={collectClipboard}>
          收纳剪贴板中的 {clipboardPaths.length} 项（Ctrl+Shift+V）
        </button>
      )}
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
          {res && results.length === 0 && <li className="quick-empty">没有匹配的对象</li>}
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
              <span className="quick-icon" data-testid="quick-result-icon" data-visual={i < QUICK_ICON_LIMIT ? "visual" : "type"}>
                {i < QUICK_ICON_LIMIT
                  ? <ItemVisualIcon item={item} emojiClass="" imageClass="quick-icon-img" />
                  : <ItemTypeIcon item={item} emojiClass="" />}
              </span>
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
        {status || dropError ? (
          <span role={status?.tone === "info" ? "status" : "alert"} data-testid="quick-status" className={status?.tone === "info" ? "" : "quick-error"}>
            {status ? status.text : `收纳失败：${dropError}`}
          </span>
        ) : (
          <span>Enter 打开 · Ctrl+Enter 位置 · Ctrl+Shift+C 复制路径 · Alt+Enter 主窗定位 · Ctrl+T 标签 · Esc 收起</span>
        )}
      </div>
    </div>
  );
}
