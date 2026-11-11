// ============================================================================
// quick/PinView.tsx — 钉住视图 / 边缘抽屉（与快速搜索共用 quick 窗口的 WebView）
// ============================================================================
// 浮动窗：标题可拖动（后端记位置），列表双击 / Enter 打开。
// 边缘抽屉：收起时本窗口隐藏，贴边的是后端的原生把手（pin_strip.rs，系统悬停判定后滑出）；
// 面板始终渲染好，滑出即见内容。展开后鼠标离开面板 PIN_LEAVE_COLLAPSE_MS 收回（失焦由后端收回）。
// 把手颜色跟随主题强调色（pin_handle_color）。没有任何轮询。
// 数据：任何来源的写入（主窗、快速窗、tl CLI）都重新取 pin_items。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import * as db from "../lib/db";
import { latestOnly, SKIPPED } from "../lib/latestOnly";
import { announceWindowWrite, onAnyDataChanged } from "../lib/dataSync";
import { itemDisplayName } from "../lib/itemDisplay";
import type { PinViewState } from "../lib/desktopShortcut";
import { quickKeyAction, stepIndex } from "./quickModel";
import { filterPinItems, PIN_ICON_LIMIT, PIN_LEAVE_COLLAPSE_MS, pinCountText } from "./pinModel";
import { ItemTypeIcon, ItemVisualIcon } from "../components/ItemVisualIcon";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PinView({ view }: { view: PinViewState }) {
  const { settings, drawer } = view;
  const isDrawer = settings.mode === "drawer";
  const collapsed = isDrawer && drawer !== "expanded";
  const sourceKey = settings.source ? `${settings.source.kind}:${settings.source.id}` : "";
  const [data, setData] = useState<db.PinItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [tick, setTick] = useState(0);
  const [load] = useState(() => latestOnly((_: null) => db.pinItems()));
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onAnyDataChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    load(null)
      .then((r) => {
        if (!alive || r === SKIPPED) return;
        setData(r);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [load, sourceKey, tick]);

  const clearTimers = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  // 原生把手跟随主题强调色（主题在本窗口启动时从快照套用；切换主题后下次视图变化时同步）
  useEffect(() => {
    if (!isDrawer) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (accent) void db.pinHandleColor(accent).catch(() => {});
  }, [isDrawer, drawer]);
  useEffect(() => clearTimers, []);
  useEffect(() => clearTimers(), [collapsed]);

  // 展开的抽屉：鼠标离开整个面板后收回
  useEffect(() => {
    if (!isDrawer || collapsed) return;
    const root = document.documentElement;
    const onLeave = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => void db.pinCollapse().catch(() => {}), PIN_LEAVE_COLLAPSE_MS);
    };
    const onEnter = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    };
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("mouseenter", onEnter);
    return () => {
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("mouseenter", onEnter);
    };
  }, [isDrawer, collapsed]);

  const items = data?.items ?? [];
  const shown = filterPinItems(items, filter);
  const current = shown[Math.min(selected, shown.length - 1)] ?? null;

  const open = useCallback(async (id: number) => {
    try {
      await db.launchItem(id);
      announceWindowWrite({ source: "quick", itemIds: [id], tagsChanged: false });
      if (isDrawer) void db.pinCollapse().catch(() => {});
    } catch (e) {
      setError(`打开失败：${errorText(e)}`);
    }
  }, [isDrawer]);


  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const action = quickKeyAction(event);
    if (!action) return;
    if (action === "escape") {
      event.preventDefault();
      if (filter) setFilter("");
      else if (isDrawer) void db.pinCollapse().catch(() => {});
      return;
    }
    if (action === "up" || action === "down") {
      event.preventDefault();
      setSelected((i) => stepIndex(shown.length, Math.min(i, shown.length - 1), action === "down" ? 1 : -1));
      return;
    }
    if (!current) return;
    if (action === "launch") {
      event.preventDefault();
      void open(current.id);
    } else if (action === "reveal") {
      event.preventDefault();
      void db.openInExplorerById(current.id).catch((e: unknown) => setError(`显示位置失败：${errorText(e)}`));
    }
  };

  const missing = data !== null && data.title === null;
  return (
    <div
      className="pin-shell pin-panel"
      data-testid="pin-panel"
      data-mode={settings.mode}
      data-edge={settings.edge}
      style={isDrawer ? { width: "var(--pin-drawer-width)" } : undefined}
    >
      <div className="pin-header" data-tauri-drag-region data-testid="pin-header">
        <span className="pin-title" data-tauri-drag-region data-testid="pin-title">
          {missing ? "来源已删除" : data?.title ?? "正在加载…"}
        </span>
        {data && !missing && <span className="pin-count" data-tauri-drag-region data-testid="pin-count">{data.total}</span>}
      </div>
      {missing ? (
        <p className="quick-empty" role="alert" data-testid="pin-missing">
          钉住的标签或文件柜已被删除。请在主窗口 设置 → 桌面驻留 → 钉住视图 里重新选择。
        </p>
      ) : (
        <>
          <input
            data-testid="pin-filter"
            className="quick-input quick-input-small"
            aria-label="筛选钉住视图"
            placeholder="筛选…"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul role="listbox" aria-label="钉住视图对象" className="quick-list" data-testid="pin-items">
            {data && shown.length === 0 && <li className="quick-empty">{filter ? "没有匹配的对象" : "这里还没有对象"}</li>}
            {shown.map((item, i) => (
              <li
                key={item.id}
                role="option"
                aria-selected={item === current}
                data-testid="pin-item"
                data-item-id={item.id}
                className={`quick-row pin-row${item.is_missing ? " quick-missing" : ""}`}
                title={item.path}
                onMouseEnter={() => setSelected(i)}
                onDoubleClick={() => void open(item.id)}
              >
                <span className="quick-icon">
                  {i < PIN_ICON_LIMIT
                    ? <ItemVisualIcon item={item} emojiClass="" imageClass="quick-icon-img" />
                    : <ItemTypeIcon item={item} emojiClass="" />}
                </span>
                <span className="quick-name">{itemDisplayName(item)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="quick-footer">
        {error ? (
          <span role="alert" className="quick-error" data-testid="pin-error">{error}</span>
        ) : (
          <span data-testid="pin-footer">
            {data && !missing ? pinCountText(data.total, items.length, shown.length, filter) : ""}
            {data && !missing ? " · 双击或 Enter 打开" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
