// ============================================================================
// src/lib/dataSync.ts — 跨窗口/跨进程数据同步事件（全局极速阶段①）
// ============================================================================
// 后端 data_sync 用 SQLite data_version 检测提交并广播 `data-changed`：
// - origin = "external"：其他进程（tl CLI 等）写库 → 本窗口需重新加载；
// - origin = "app"：本应用写库（发起窗口已自行更新）→ 主窗忽略，留给后续快速窗等其他窗口。
// ============================================================================

export const DATA_CHANGED_EVENT = "data-changed";

export type DataChangeOrigin = "external" | "app";

export interface DataChangedPayload {
  origin: DataChangeOrigin;
  seq: number;
  /** 后端检测到变化的时刻（Unix 毫秒） */
  detectedAtMs: number;
}

/** 合并同一时刻多个 hook 的重载请求，避免外部批量写入时连发事件导致重复全量拉取。 */
export const EXTERNAL_RELOAD_COALESCE_MS = 16;

/**
 * 订阅外部写入：返回取消函数。listen 是异步注册，取消早于注册完成时立即停掉（StrictMode 双挂载）。
 * 同一轮事件在 EXTERNAL_RELOAD_COALESCE_MS 内只回调一次。
 */
export function onExternalDataChanged(handler: (payload: DataChangedPayload) => void): () => void {
  return subscribeDataChanged((payload) => payload.origin === "external", handler);
}

/**
 * 订阅任意来源的写入（快速搜索窗用：主窗或本应用其他窗口写库后它也要重新加载）。
 * 同样按 EXTERNAL_RELOAD_COALESCE_MS 合并。
 */
export function onAnyDataChanged(handler: (payload: DataChangedPayload) => void): () => void {
  return subscribeDataChanged(() => true, handler);
}

function subscribeDataChanged(
  accept: (payload: DataChangedPayload) => boolean,
  handler: (payload: DataChangedPayload) => void,
): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: DataChangedPayload | null = null;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<DataChangedPayload>(DATA_CHANGED_EVENT, (event) => {
      if (cancelled || !event.payload || !accept(event.payload)) return;
      latest = event.payload;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!cancelled && latest) handler(latest);
      }, EXTERNAL_RELOAD_COALESCE_MS);
    }))
    .then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    unlisten?.();
  };
}

// ---- 窗口间写入通知（阶段②）：带对象 ID，接收方按 ID 增量刷新 ----

/** 某个窗口写库后广播：data-changed 只说明「库变了」，这里补上「哪些对象变了」 */
export const WINDOW_DATA_WRITTEN_EVENT = "window-data-written";

export type WindowSource = "main" | "quick";

export interface WindowDataWritten {
  source: WindowSource;
  /** 受影响对象（打标签、启动刷新最近使用时间等） */
  itemIds: number[];
  /** 标签表本身变了（新建标签等），接收方需重读标签 */
  tagsChanged: boolean;
}

export function announceWindowWrite(payload: WindowDataWritten): void {
  void import("@tauri-apps/api/event")
    .then(({ emit }) => emit(WINDOW_DATA_WRITTEN_EVENT, payload))
    .catch(() => {});
}

/** 订阅其他窗口的写入（忽略本窗口 self 自己发出的） */
export function onWindowDataWritten(
  self: WindowSource,
  handler: (payload: WindowDataWritten) => void,
): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<WindowDataWritten>(WINDOW_DATA_WRITTEN_EVENT, (event) => {
      const payload = event.payload;
      if (cancelled || !payload || payload.source === self) return;
      handler({
        source: payload.source,
        itemIds: Array.isArray(payload.itemIds) ? payload.itemIds.filter((id) => typeof id === "number") : [],
        tagsChanged: Boolean(payload.tagsChanged),
      });
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
}
